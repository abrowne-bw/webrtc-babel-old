// Bandwidth Imports
import BandwidthRtc from "@bandwidth/webrtc-browser";
const bandwidthRtc = new BandwidthRtc();
const port = 3000;
const basePath = "http://localhost:"+port;

// Amazon Imports
// Utilities for Amazon Transcribe
const audioUtils        = require('./audioUtils');  // for encoding audio data as PCM
const crypto            = require('crypto'); // tot sign our pre-signed URL
const v4                = require('./aws-signature-v4'); // to generate our pre-signed URL
const marshaller        = require("@aws-sdk/eventstream-marshaller"); // for converting binary event stream messages to and from JSON
const util_utf8_node    = require("@aws-sdk/util-utf8-node"); // utilities for encoding and decoding UTF8
const mic               = require('microphone-stream'); // collect microphone input as a stream of raw bytes

// Utilities and clients for Amazon services
var AWS = require('aws-sdk');
var polly;
var translateClient;
var signer;
// Map language codes from the Polly codes to their Translate equivalents
const langCodesMap = new Map([
    ['arb','ar'],
    ['cmn-CN','zh'],
    ['da-DK','da'],
    ['nl-NL','nl'],
    ['en-AU','en'],
    ['en-GB','en'],
    ['en-IN','en'],
    ['en-US','en'],
    ['en-GB-WLS','en'],
    ['fr-FR','fr'],
    ['fr-CA','fr-CA'],
    ['hi-IN','hi'],
    ['de-DE','de'],
    ['is-IS','is'],
    ['it-IT','it'],
    ['ja-JP','ja'],
    ['ko-KR','ko'],
    ['nb-NO','no'],
    ['pl-PL','pl'],
    ['pt-BR','pt'],
    ['pt-PT','pt'],
    ['ro-RO','ro'],
    ['ru-RU','ru'],
    ['es-ES','es'],
    ['es-MX','es-MX'],
    ['es-US','es-MX'],
    ['sv-SE','sv'],
    ['tr-TR','tr'],
    ['cy-GB','cy']
]); //this map tracks the language codes from Polly to Translate
const langCodeToVoiceMap = new Map([
    ['arb', 'Zeina'],
    ['cmn-CN', 'Zhiyu'],
    ['da-DK', 'Naja'],
    ['nl-NL', 'Lotte'],
    ['en-AU','Olivia'],
    ['en-GB','Amy'],
    ['en-IN','Aditi'],
    ['en-US','Joanna'],
    ['en-GB-WLS','Geraint'],
    ['fr-FR','Mathieu'],
    ['fr-CA','Chantal'],
    ['de-DE','Marlene'],
    ['hi-IN','Aditi'],
    ['is-IS','Karl'],
    ['it-IT','Bianca'],
    ['ja-JP','Mizuki'],
    ['ko-KR','Seoyeon'],
    ['nb-NO','Liv'],
    ['pl-PL','Ewa'],
    ['pt-BR','Camila'],
    ['pt-PT','Ines'],
    ['ro-RO','Carmen'],
    ['ru-RU','Tatyana'],
    ['es-ES','Conchita'],
    ['es-MX','Mia'],
    ['es-US','Lupe'],
    ['sv-SE','Astrid'],
    ['tr-TR','Filiz'],
    ['cy-GB','Gwyneth']
]); // this map tracks the voices we must use when callling specific languages in Polly

// our converter between binary event streams messages and JSON
const eventStreamMarshaller = new marshaller.EventStreamMarshaller(util_utf8_node.toUtf8, util_utf8_node.fromUtf8);
//--End of Amazon Imports--

// global state variables
let srcLanguageCode;
let targetLanguageCode;
let region;
let sampleRate;
let inputSampleRate;
let srcTranscription="";
let targetTranscription="";
let socket;
let audioStream; 
let socketError = false;
let transcribeException = false;
let localStream; 

/**
 * Setup our listeners for the events from the media server
 */
window.addEventListener("load", (event) => {
    console.log("loading listeners");
    bandwidthRtc.onStreamAvailable((rtcStream) => {
        console.log("receiving audio!");
        document.getElementById("mediaPlayer").srcObject = rtcStream.mediaStream; // set up audio playback on the browser
        localStream = rtcStream.mediaStream;
        console.log("local stream defined");
    });
    bandwidthRtc.onStreamUnavailable((endpointId) => {
        console.log("no longer receiving audio");
        document.getElementById("mediaPlayer").srcObject = undefined; // when the call ends, remove media stream from webpage

        // update the interface
        if (!document.getElementById("endButton").disabled) {
            alert("Call ended, stream is unavailable");
        }

        setActive();
        disableButton("endButton");
        enableButton("callButton");
    });
});

/**
 * Get the token required to auth with the media server
 */
$('#onlineButton').click(async function() {
    disableButton("onlineButton");
    console.log("Fetching token from server");
    const url = basePath + "/startBrowserCall";
    const res = await fetch(url);
    //basic error handling
    if (res.status != 200) {
        console.log(res);
        alert("Failed to set you up as a participant: " + res.status);
    } else {
        const json = await res.json();
        startStreaming(json.token);
    }
})

/**
 * Now that we have the token, we can start streaming media
 * The token param is fetched from the server above
 */
async function startStreaming(token) {
    console.log("connecting to BAND WebRTC server");
    // Connect to Bandwidth WebRTC

    await bandwidthRtc.connect({ deviceToken: token });
    console.log("connected to bandwidth webrtc!");
    // Publish the browser's microphone
    await bandwidthRtc.publish({
        audio: true,
        video: false,
    });
    
    console.log("browser mic is streaming");
    // update ui status & enable the next step
    setActive();
    enableButton("callButton");
}

$('#start-button').click(function () {
    $('#error').hide(); // hide any existing errors
    toggleStartStop(true); // disable start and enable stop button

    // set the language and region from the dropdowns, create the translate/polly clients
    setLanguages();
    setRegion();
    initTranslateClient();

    streamAudioToWebSocket(localStream); // stream bandwidth-rtc's media stream to AWS for transcription
    
});

/**
 * Reach out to our Server app to start the PSTN call
 */
$('#callButton').click(async function () {
    // prevent double clicks
    disableButton("callButton");
    const url = basePath + "/startPSTNCall";

    console.log("About to make a call");
    let res = await fetch(url);
    console.log(res);
    if (res.status !== 200) {
        console.log(res);
        alert("Failed to set you up as a participant: " + res.status);
    } else {
        setInCall();
        enableButton("endButton");
    }
})

$('#endButton').click(async function() {
    const url = basePath + "/endPSTNCall";
    console.log("About to make a call");
    try {
        const res = await fetch(url);
        const json = await res.json();
        console.log(json)
        // enable the next step
        setActive();
        disableButton("endButton");
        enableButton("callButton");
        //stop Amazon Transcription
        closeSocket();
        //toggleStartStop();
    } catch(error) {
        console.error("Error in callPSTN:", error);
    }
})
//----------------------------------------------------------------------------------------------------------------
//UI Functions
//----------------------------------------------------------------------------------------------------------------
//Online indicator
function setInCall() {
    var statusDiv = document.getElementById("call_status");
    statusDiv.innerHTML = "Online - IN Call";
    statusDiv.style.color = "green";
}
function setActive() {
    var statusDiv = document.getElementById("call_status");
    statusDiv.innerHTML = "Online - no Call";
    statusDiv.style.color = "green";
}
function setInactive() {
    var statusDiv = document.getElementById("call_status");
    statusDiv.innerHTML = "Offline";
    statusDiv.style.color = "red";
}

// buttons 
function enableButton(buttonId) {
    document.getElementById(buttonId).disabled = false;
}
function disableButton(buttonId) {
    document.getElementById(buttonId).disabled = true;
}

/**-----------------------------------------------------------------------------
 *----------------------------AMAZON TRANSCRIBE CODE----------------------------
 *----------------------------------------------------------------------------*/

/**
 * This function will send our media stream from the phone call to AWS via a websocket
 * @param rtcMediaStream bandwidth webrtc-browser sdk's media stream 
 *
 */
let streamAudioToWebSocket = function (rtcMediaStream) {
    audioStream = new mic(); //mic objects are convenient for formatting sample rates

    audioStream.on("format", function(data) {
        inputSampleRate = data.sampleRate;
    });

    audioStream.setStream(rtcMediaStream);

    // Pre-signed URLs are a way to authenticate a request (or WebSocket connection, in this case)
    // via Query Parameters. Learn more: https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    let url = createPresignedUrl();

    console.log('streaming to ', url);

    //open up our WebSocket connection
    socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";

    let sampleRate = 0;

    // when we get audio data from the mic, send it to the WebSocket if possible
    socket.onopen = function() {
        audioStream.on('data', function(rawAudioChunk) {
            // the audio stream is in raw audio bytes. Transcribe expects PCM with additional metadata, encoded as binary
            let binary = convertAudioToBinaryMessage(rawAudioChunk);

            if (socket.readyState === socket.OPEN) // start streaming
                socket.send(binary);
        }
    )};

    // handle messages, errors, and also close events
    wireSocketEvents();
}


//Configuration
function setLanguages() {
    // set the source language
    srcLanguageCode = $('#language').find(':selected').val();
    if (srcLanguageCode == "en-US" || srcLanguageCode == "es-US")
        sampleRate = 44100; 
    else
        sampleRate = 8000;

    // set the language to translate to
    targetLanguageCode = $('#translated-lang').find(':selected').val();
}

function setRegion() {
    region = $('#region').find(':selected').val();
    // configure the region of our translate client
    //translateClient = new TranslateClient({ region: region});
}


function wireSocketEvents() {
    // handle inbound messages from Amazon Transcribe
    socket.onmessage = function (message) {
        //convert the binary event stream message to JSON
        let messageWrapper = eventStreamMarshaller.unmarshall(Buffer(message.data));
        let messageBody = JSON.parse(String.fromCharCode.apply(String, messageWrapper.body));
        if (messageWrapper.headers[":message-type"].value === "event") {
            handleEventStreamMessage(messageBody);
        }
        else {
            transcribeException = true;
            showError(messageBody.Message);
            toggleStartStop();
        }
    };

    socket.onerror = function () {
        socketError = true;
        showError('WebSocket connection error. Try again.');
        toggleStartStop();
    };
    
    socket.onclose = function (closeEvent) {
        audioStream.stop();
        
        // the close event immediately follows the error event; only handle one.
        if (!socketError && !transcribeException) {
            if (closeEvent.code != 1000) {
                showError('</i><strong>Streaming Exception</strong><br>' + closeEvent.reason);
            }
            toggleStartStop();
        }
    };
}

let handleEventStreamMessage = function (messageJson) {
    let results = messageJson.Transcript.Results;

    if (results.length > 0) {
        if (results[0].Alternatives.length > 0) {
            let transcript = results[0].Alternatives[0].Transcript;

            // fix encoding for accented characters
            transcript = decodeURIComponent(escape(transcript));

            // update the textarea with the latest result
            $('#transcript').val(srcTranscription + transcript + "\n");

            // if this transcript segment is final, add it to the overall transcription
            if (!results[0].IsPartial) {
                // scroll the textarea down
                $('#transcript').scrollTop($('#transcript')[0].scrollHeight);

                translateAndDisplay(transcript);
                srcTranscription += transcript + "\n";
                // translate and transcribe the result
            }
        }
    }
}

let closeSocket = function () {
    if (socket.readyState === socket.OPEN) {
        audioStream.stop();

        // Send an empty frame so that Transcribe initiates a closure of the WebSocket after submitting all transcripts
        let emptyMessage = getAudioEventMessage(Buffer.from(new Buffer([])));
        let emptyBuffer = eventStreamMarshaller.marshall(emptyMessage);
        socket.send(emptyBuffer);
    }
}



$('#stop-button').click(function() {
    closeSocket();
    toggleStartStop();
})


$('#reset-button').click(function() {
    // clear both transcripts
    $('#transcript').val('');
    srcTranscription = '';
    $('#translated-transcript').val('');
    targetTranscription = '';
})

function toggleStartStop(disableStart = false) {
    $('#start-button').prop('disabled', disableStart);
    $('#stop-button').attr('disabled', !disableStart);
}

function showError(message) {
    $('#error').html('<i class="fa fa-times-circle"></i> ' + message);
    $('#error').show();
}

function convertAudioToBinaryMessage(audioChunk) {
    let raw = mic.toRaw(audioChunk);

    if (raw == null)
        return;

    // downsample and convert the raw audio bytes to PCM
    let downsampledBuffer = audioUtils.downsampleBuffer(raw, inputSampleRate, sampleRate);
    let pcmEncodedBuffer = audioUtils.pcmEncode(downsampledBuffer);

    // add the right JSON headers and structure to the message
    let audioEventMessage = getAudioEventMessage(Buffer.from(pcmEncodedBuffer));

    //convert the JSON object + headers into a binary event stream message
    let binary = eventStreamMarshaller.marshall(audioEventMessage);

    return binary;
}

function getAudioEventMessage(buffer) {
    // wrap the audio data in a JSON envelope
    return {
        headers: {
            ':message-type': {
                type: 'string',
                value: 'event'
            },
            ':event-type': {
                type: 'string',
                value: 'AudioEvent'
            }
        },
        body: buffer
    };
}

function createPresignedUrl() {
    let endpoint = "transcribestreaming." + region + ".amazonaws.com:8443";

    // get a preauthenticated URL that we can use to establish our WebSocket
    return v4.createPresignedURL(
        'GET',
        endpoint,
        '/stream-transcription-websocket',
        'transcribe',
        crypto.createHash('sha256').update('', 'utf8').digest('hex'), {
            'key': $('#access_id').val(),
            'secret': $('#secret_key').val(),
            'sessionToken': $('#session_token').val(),
            'protocol': 'wss',
            'expires': 15,
            'region': region,
            'query': "language-code=" + srcLanguageCode + "&media-encoding=pcm&sample-rate=" + sampleRate
        }
    );
}

function translateAndDisplay(text) {
    if(!text) {
        console.log("Error: No text entered");
        showError("You must enter text to translate");
        exit();
    }
    
    var params = {
        Text: text,
        SourceLanguageCode: langCodesMap.get(srcLanguageCode),
        TargetLanguageCode: langCodesMap.get(targetLanguageCode) 
    };

    translateClient.translateText(params, function (err, data) {
        if (err) {
            console.log(err, err.stack);
        } else {
            let translatedPhrase = data.TranslatedText;
            $('#translated-transcript').val(targetTranscription + translatedPhrase + "\n");
            $('#translated-transcript').scrollTop($('#translated-transcript')[0].scrollHeight); //add to overall transcription

            targetTranscription += translatedPhrase + "\n"; //keep track of updated transcript
            readOutTranslation(translatedPhrase);
        }
    });

}
/**
 * This function initializes translate/polly clients 
 *  It is assumed that the necessary credentials have been added upon function call
 */
function initTranslateClient() {
    AWS.config.update({region: region});
    AWS.config.credentials = new AWS.Credentials(
        $('#access_id').val(),
        $('#secret_key').val()
    );

    translateClient = new AWS.Translate();
    polly = new AWS.Polly();
}

/**
 * This function will read out the text given in its language
 *  -> The language the text is in is implicit here for calling Polly, each voice is unique to a different language
 *  -> For that reason, we used a map to go from the target language code to a voice
 * @param text Text to be read out
 */

async function readOutTranslation(text) {
    // set polly parameters
    var params = {
        OutputFormat: "mp3",
        SampleRate: "16000",
        Text: text,
        VoiceId: langCodeToVoiceMap.get(targetLanguageCode)
    };
    // the signer will call Polly and store the resulting audioStream in S3
    signer = new AWS.Polly.Presigner(params, polly); // create signer

    signer.getSynthesizeSpeechUrl(params, function (err, url) {
        if(err) {
            console.log("ERROR:",err);
        } else {
            // Set the source of our audio playback to the S3 file
            // The HTML5 audio component will autoplay its source
            document.getElementById('audioSource').src = url;
            document.getElementById('audioPlayback').load();
        }
    })
}