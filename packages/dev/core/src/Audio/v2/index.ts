// TODO: What's the best way to expose the WebAudio factory functions without exposing the WebAudio classes?
export { SoundState } from "./soundState";
export { CreateAudioEngineAsync } from "./webAudio/webAudioEngine";
export { CreateMainAudioBusAsync } from "./webAudio/webAudioMainBus";
export { CreateSoundAsync, CreateSoundBufferAsync } from "./webAudio/webAudioStaticSound";
export { CreateStreamingSoundAsync } from "./webAudio/webAudioStreamingSound";
