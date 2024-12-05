import { Observable } from "../../../Misc/observable";
import type { Nullable } from "../../../types";
import type { AbstractAudioNode } from "../abstractAudioNode";
import type { AbstractSound } from "../abstractSound";
import type { _AbstractSoundInstance } from "../abstractSoundInstance";
import { AudioEngineV2 } from "../audioEngineV2";
import type { MainAudioBus } from "../mainAudioBus";
import { CreateMainAudioBusAsync } from "./webAudioMainBus";
import type { _WebAudioMainOutput } from "./webAudioMainOutput";
import { _CreateMainAudioOutputAsync } from "./webAudioMainOutput";

/**
 * Options for creating a new v2 audio engine that uses the WebAudio API.
 */
export interface IWebAudioEngineOptions {
    /**
     * The audio context to be used by the engine.
     */
    audioContext?: AudioContext;

    /**
     * Set to `true` to automatically resume the audio context when the user interacts with the page. Default is `true`.
     */
    resumeOnInteraction?: boolean;

    /**
     * Set to `true` to automatically resume the audio context when the browser pauses audio playback. Default is `true`.
     */
    resumeOnPause?: boolean;

    /**
     * The interval in milliseconds to try resuming audio playback when `resumeOnPause` is `true`. Default is `1000`.
     */
    resumeOnPauseRetryInterval?: number;
}

/**
 * Creates a new v2 audio engine that uses the WebAudio API.
 * @param options - The options for creating the audio engine.
 * @returns A promise that resolves with the created audio engine.
 */
export async function CreateAudioEngineAsync(options: Nullable<IWebAudioEngineOptions> = null): Promise<AudioEngineV2> {
    const engine = new _WebAudioEngine(options ?? {});
    await engine.init(options);
    return engine;
}

const formatMimeTypeMap = new Map<string, string>([
    ["aac", "audio/aac"],
    ["ac3", "audio/ac3"],
    ["flac", "audio/flac"],
    ["m4a", "audio/mp4"],
    ["mp3", 'audio/mpeg; codecs="mp3"'],
    ["mp4", "audio/mp4"],
    ["ogg", 'audio/ogg; codecs="vorbis"'],
    ["wav", "audio/wav"],
    ["webm", 'audio/webm; codecs="vorbis"'],
]);

/** @internal */
export class _WebAudioEngine extends AudioEngineV2 {
    private _audioContextStarted = false;
    private _resumePromise: Nullable<Promise<void>> = null;

    private _mainOutput: Nullable<_WebAudioMainOutput> = null;

    private _invalidFormats = new Set<string>();
    private _validFormats = new Set<string>();
    private _volume = 1;

    /** @internal */
    public readonly audioContext: AudioContext;

    /** @internal */
    public get isWebAudio(): boolean {
        return true;
    }

    /** @internal */
    public readonly isReadyPromise: Promise<void> = new Promise((resolve) => {
        this._resolveIsReadyPromise = resolve;
    });

    private _resolveIsReadyPromise: () => void;

    /** @internal */
    public get currentTime(): number {
        return this.audioContext.currentTime ?? 0;
    }

    /** @internal */
    public get mainOutput(): Nullable<AbstractAudioNode> {
        return this._mainOutput;
    }

    private _initAudioContext: () => Promise<void> = async () => {
        this.audioContext.addEventListener("statechange", this._onAudioContextStateChange);

        this._mainOutput = await _CreateMainAudioOutputAsync(this);
        this._mainOutput.volume = this._volume;

        await CreateMainAudioBusAsync("default", this);
    };

    private _onUserInteraction: () => void = async () => {
        if (this._resumeOnInteraction) {
            await this.audioContext.resume();

            const it = this._soundInstancesToStartOnNextUserInteraction.values();
            let next = it.next();

            while (!next.done) {
                const instance = next.value;

                instance.play();
                this._soundInstancesToStartOnNextUserInteraction.delete(instance);

                next = it.next();
            }
        }
    };

    private _onAudioContextStateChange = () => {
        if (this.state === "running") {
            clearInterval(this._resumeOnPauseTimerId);
            this._audioContextStarted = true;
            this._resumePromise = null;
        }
        if (this.state === "suspended" || this.state === "interrupted") {
            if (this._audioContextStarted && this._resumeOnPause) {
                clearInterval(this._resumeOnPauseTimerId);

                this._resumeOnPauseTimerId = setInterval(() => {
                    this.resume();
                }, this._resumeOnPauseRetryInterval);
            }
        }

        this.stateChangedObservable.notifyObservers(this.state);
    };

    private _resumeOnInteraction = true;
    private _resumeOnPause = true;
    private _resumeOnPauseRetryInterval = 1000;
    private _resumeOnPauseTimerId: any = null;

    private _soundInstancesToStartOnNextUserInteraction = new Set<_AbstractSoundInstance>();

    /** @internal */
    public get state(): string {
        return this.audioContext.state;
    }

    /** @internal */
    public stateChangedObservable: Observable<string> = new Observable();

    /** @internal */
    public get webAudioInputNode(): AudioNode {
        return this.audioContext.destination;
    }

    /** @internal */
    public get volume(): number {
        return this._volume;
    }

    /** @internal */
    public set volume(value: number) {
        if (this._volume === value) {
            return;
        }

        this._volume = value;

        if (this._mainOutput) {
            this._mainOutput.volume = value;
        }
    }

    /** @internal */
    public constructor(options: IWebAudioEngineOptions) {
        super();

        this.audioContext = options?.audioContext ?? new AudioContext();
    }

    /** @internal */
    public async init(options: Nullable<IWebAudioEngineOptions> = null): Promise<void> {
        this._resumeOnInteraction = options?.resumeOnInteraction ?? true;
        this._resumeOnPause = options?.resumeOnPause ?? true;
        this._resumeOnPauseRetryInterval = options?.resumeOnPauseRetryInterval ?? 1000;

        document.addEventListener("click", this._onUserInteraction);

        await this._initAudioContext();
        this._resolveIsReadyPromise();
    }

    /** @internal */
    public override dispose(): void {
        super.dispose();

        if (this.audioContext.state !== "closed") {
            this.audioContext.close();
        }

        document.removeEventListener("click", this._onUserInteraction);
        this.audioContext.removeEventListener("statechange", this._onAudioContextStateChange);
    }

    /** @internal */
    public flagInvalidFormat(format: string): void {
        this._invalidFormats.add(format);
    }

    /** @internal */
    public formatIsValid(format: string): boolean {
        if (this._validFormats.has(format)) {
            return true;
        }

        if (this._invalidFormats.has(format)) {
            return false;
        }

        const mimeType = formatMimeTypeMap.get(format);
        if (mimeType === undefined) {
            return false;
        }

        const audio = new Audio();
        if (audio.canPlayType(mimeType) === "") {
            this._invalidFormats.add(format);
            return false;
        }

        this._validFormats.add(format);

        return true;
    }

    /** @internal */
    public override async pause(): Promise<void> {
        await this.audioContext.suspend();
    }

    /** @internal */
    public override async resume(): Promise<void> {
        if (this._resumePromise) {
            return this._resumePromise;
        }

        this._resumePromise = this.audioContext.resume();
    }

    /** @internal */
    public addMainBus(mainBus: MainAudioBus): void {
        this._addMainBus(mainBus);
    }

    /** @internal */
    public addSound(sound: AbstractSound): void {
        this._addSound(sound);
    }

    /** @internal */
    public addSoundInstance(soundInstance: _AbstractSoundInstance): void {
        this._addSoundInstance(soundInstance);
    }

    /** @internal */
    public startSoundInstanceOnNextUserInteraction(soundInstance: _AbstractSoundInstance): void {
        this._soundInstancesToStartOnNextUserInteraction.add(soundInstance);
    }
}
