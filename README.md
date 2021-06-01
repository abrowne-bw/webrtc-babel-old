# Bandwidth WebRTC-Babel
 Real-time transcription and translation implemented with Bandwidth's WebRTC

## Getting started

To understand how this app works, please look at https://github.com/Bandwidth-Samples/webrtc-hello-world-js and https://github.com/amazon-archives/amazon-transcribe-websocket-static. 
## Setting things up

To run this app, you'll need a Bandwidth phone number, Voice API credentials and WebRTC enabled for your account. Please check with your account manager to ensure you are provisioned for WebRTC.

In order to run this app, you must have API access to Amazon Transcribe, Translate, and Polly. To sign up, please visit https://aws.amazon.com/free.

This app will need be publicly accessible to the internet in order for Bandwidth API callbacks to work properly. Otherwise you'll need a tool like [ngrok](https://ngrok.com) to provide access from Bandwidth API callbacks to localhost.

### Create a Bandwidth Voice API application

Follow the steps in [How to Create a Voice API Application](https://support.bandwidth.com/hc/en-us/articles/360035060934-How-to-Create-a-Voice-API-Application-V2-) to create your Voice API appliation.

In step 7 and 8, make sure they are set to POST.

In step 9, provide the publicly accessible URL of your sample app. You need to add `/incomingCall` to the end of this URL in the Voice Application settings.

You do no need to set a callback user id or password.

Create the application and make note of your _Application ID_. You will provide this in the settings below.

### Configure your Bandwidth API Credentials

Copy the default configuration files

```bash
cp .env.default .env
```

Add your Bandwidth account settings to `.env`:
- BW_ACCOUNT_ID
- BW_USERNAME
- BW_PASSWORD

Add your Voice API application information:
- BW_VOICE_APPLICATION_ID

Enter your local server address (e.g. ngrok url):
- BASE_CALLBACK_URL

Make sure you are running ngrok on port `3000`, or otherwise change the `port` variable in `server.js` and `client.js`.
```bash
./ngrok http 3000
```

To make an outbound call from the browser, add a phone number to dial:
- USER_NUMBER
- BW_NUMBER (the number that will appear as the FROM for the call)


You can ignore any other settings in the `.env.default` file.

### Install dependencies and build

```bash
npm install
npm run-script build && node server.js
```

### Setting Up 

Browse to [http://localhost:3000](http://localhost:3000) and grant permission to use your microphone.

- clicking *Get Online* will get a token for your browser, get you connected to our media server, and start media flowing from the browser
- clicking *Dial out* will request the server to start a call out to USER_NUMBER via the Voice API
- clicking *End Call* will request the server to hangup the outbound call
- clicking *Start Transcription* will begin transcribing what you speak into your phone
- clicking *Stop Transcription* will pause the transcription process
- clicking *Clear Transcript* will clear both transcripts
- select the language you are speaking in from the dropdown menu *Source Language*
- select the language you would like your voice to be translated to from the dropdown menu *Translate to*
- select the closest *region* to where you are located 
- enter your AWS access key under *Access ID*
- enter your AWS secret key under *Secret Key*


### Using the app

Please follow this sequence of steps to run this example app:
1) Click *Get Online* - connect to Bandwidth's media server
2) Set your desired *Access ID*, *Secret Key*, *Source Language*, *Translate to*, and *Region*
3) Click *Dial Out* - call the `USER_NUMBER` specified in `.env`
4) Have the user speak something or otherwise trigger their microphone in order to get media flowing
5) Whenever you are ready, click *Start Transcription*. You should see the source transcript updating in real time and the translated transcript updating
   whenever a phrase is completed. When a phrase is completed, you should also hear the translated text spoken out on your speakers.


Enjoy!