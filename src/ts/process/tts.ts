import { alertError } from "../alert";
import { getCurrentCharacter, getDatabase, type character } from "../storage/database.svelte";
import { runTranslator, translateVox } from "../translator/translator";
import { globalFetch, loadAsset } from "../globalApi.svelte";
import { language } from "src/lang";
import { sleep } from "../util";
import { runVITS } from "./transformers";

let sourceNode:AudioBufferSourceNode = null

export async function sayTTS(character:character,text:string) {
    try {
        if(!character){
            const v = getCurrentCharacter()
            if(v.type === 'group'){
                return
            }
            character = v
        }

        if(!text){
            return
        }
    
        let db = getDatabase()
        text = text.replace(/\*/g,'')
    
        if(character.ttsReadOnlyQuoted){
            const matches = text.match(/["「](.*?)["」]/g)
            if(matches && matches.length > 0){
                text = matches.map(match => match.slice(1, -1)).join("");
            }
            else{
                text = ''
            }
        }
    
        switch(character.ttsMode){
            case "webspeech":{
                if(speechSynthesis && SpeechSynthesisUtterance){
                    const utterThis = new SpeechSynthesisUtterance(text);
                    const voices = speechSynthesis.getVoices();
                    let voiceIndex = 0
                    for(let i=0;i<voices.length;i++){
                        if(voices[i].name === character.ttsSpeech){
                            voiceIndex = i
                        }
                    }
                    utterThis.voice = voices[voiceIndex]
                    const speak = speechSynthesis.speak(utterThis)
                }
                break
            }
            case "elevenlab": {
                const audioContext = new AudioContext();
                const da = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${character.ttsSpeech}`, {
                    body: JSON.stringify({
                        text: text,
                        model_id: "eleven_multilingual_v2"
                    }),
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        'xi-api-key': db.elevenLabKey || undefined
                    }
                })
                if(da.status >= 200 && da.status < 300){
                    const audioBuffer = await audioContext.decodeAudioData(await da.arrayBuffer())
                    sourceNode = audioContext.createBufferSource();
                    sourceNode.buffer = audioBuffer;
                    sourceNode.connect(audioContext.destination);            
                    sourceNode.start();
                }
                else{
                    alertError(await da.text())
                }
                break
            }
            case "VOICEVOX": {
                const jpText = await translateVox(text)
                const audioContext = new AudioContext();
                const query = await fetch(`${db.voicevoxUrl}/audio_query?text=${jpText}&speaker=${character.ttsSpeech}`, {
                    method: 'POST',
                    headers: { "Content-Type": "application/json"},
                })
                if (query.status == 200){
                    const queryJson = await query.json();
                    const bodyData = {
                        accent_phrases: queryJson.accent_phrases,
                        speedScale: character.voicevoxConfig.SPEED_SCALE,
                        pitchScale: character.voicevoxConfig.PITCH_SCALE,
                        volumeScale: character.voicevoxConfig.VOLUME_SCALE,
                        intonationScale: character.voicevoxConfig.INTONATION_SCALE,
                        prePhonemeLength: queryJson.prePhonemeLength,
                        postPhonemeLength: queryJson.postPhonemeLength,
                        outputSamplingRate: queryJson.outputSamplingRate,
                        outputStereo: queryJson.outputStereo,
                        kana: queryJson.kana,
                    }
                    const getVoice = await fetch(`${db.voicevoxUrl}/synthesis?speaker=${character.ttsSpeech}`, {
                        method: 'POST',
                        headers: { "Content-Type": "application/json"},
                        body: JSON.stringify(bodyData),
                    })
                    if (getVoice.status == 200 && getVoice.headers.get('content-type') === 'audio/wav'){
                        const audioBuffer = await audioContext.decodeAudioData(await getVoice.arrayBuffer())
                        sourceNode = audioContext.createBufferSource();
                        sourceNode.buffer = audioBuffer;
                        sourceNode.connect(audioContext.destination);
                        sourceNode.start();
                    }
                }
                break
            }
            case 'openai':{
                const key = db.openAIKey
                const res = await globalFetch('https://api.openai.com/v1/audio/speech', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + key,
                    },
                    body: {
                        model: 'tts-1',
                        input: text,
                        voice: character.oaiVoice,
                        
                    },
                    rawResponse: true,
                })
                const dat = res.data
    
                if(res.ok){
                    try {
                        const audio = Buffer.from(dat).buffer
                        const audioContext = new AudioContext();
                        const audioBuffer = await audioContext.decodeAudioData(audio)
                        sourceNode = audioContext.createBufferSource();
                        sourceNode.buffer = audioBuffer;
                        sourceNode.connect(audioContext.destination);
                        sourceNode.start();
                    } catch (error) {                    
                        alertError(language.errors.httpError + `${error}`)
                    }
                }
                else{
                    if(dat.error && dat.error.message){                    
                        alertError((language.errors.httpError + `${dat.error.message}`))
                    }
                    else{                    
                        alertError((language.errors.httpError + `${Buffer.from(res.data).toString()}`))
                    }
                }
                break;
    
            }
            case 'novelai': {
                const audioContext = new AudioContext();
                if(text === ''){
                    break;
                }
                const encodedText = encodeURIComponent(text);
                const encodedSeed = encodeURIComponent(character.naittsConfig.voice);
    
                const url = `https://api.novelai.net/ai/generate-voice?text=${encodedText}&voice=-1&seed=${encodedSeed}&opus=false&version=${character.naittsConfig.version}`;
    
                const response = await globalFetch(url, {
                    method: 'GET',
                    headers: {
                        "Authorization": "Bearer " + db.NAIApiKey,
                    },
                    rawResponse: true
                });
            
                if (response.ok) {
                    const audioBuffer = response.data.buffer;
                    audioContext.decodeAudioData(audioBuffer, (decodedData) => {
                        const sourceNode = audioContext.createBufferSource();
                        sourceNode.buffer = decodedData;
                        sourceNode.connect(audioContext.destination);
                        sourceNode.start();
                    });
                } else {
                    alertError("Error fetching or decoding audio data");
                }
                break;
            }
            case 'huggingface': {
                while(true){
                    if(character.hfTTS.language !== 'en'){
                        text = await runTranslator(text, false, 'en', character.hfTTS.language)
                    }
                    const audioContext = new AudioContext();
                    const response = await fetch(`https://api-inference.huggingface.co/models/${character.hfTTS.model}`, {
                        method: 'POST',
                        headers: {
                            "Authorization": "Bearer " + db.huggingfaceKey,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            inputs: text,
                        })
                    });
        
                    if(response.status === 503 && response.headers.get('content-type') === 'application/json'){
                        const json = await response.json()
                        if(json.estimated_time){
                            await sleep(json.estimated_time * 1000)
                            continue
                        }
                    }
                    else if(response.status >= 400){
                        alertError(language.errors.httpError + `${await response.text()}`)
                        return
                    }
                    else if (response.status === 200) {
                        const audioBuffer = await response.arrayBuffer();
                        audioContext.decodeAudioData(audioBuffer, (decodedData) => {
                            const sourceNode = audioContext.createBufferSource();
                            sourceNode.buffer = decodedData;
                            sourceNode.connect(audioContext.destination);
                            sourceNode.start();
                        });
                    } else {
                        alertError("Error fetching or decoding audio data");
                    }
                    return
                }
            }
            case 'vits':{
                await runVITS(text, character.vits)
                break;
            }
            case 'gptsovits':{
                const audioContext = new AudioContext();

                const audio: Uint8Array = await loadAsset(character.gptSoVitsConfig.ref_audio_data.assetId);
                const base64Audio = btoa(new Uint8Array(audio).reduce((data, byte) => data + String.fromCharCode(byte), ''));

                const body = {
                    text: text,
                    text_lang: character.gptSoVitsConfig.text_lang,
                    ref_audio_path: undefined,
                    ref_audio_name: character.gptSoVitsConfig.ref_audio_data.fileName,
                    ref_audio_data: base64Audio,
                    prompt_text: undefined,
                    prompt_lang: character.gptSoVitsConfig.prompt_lang,
                    top_p: character.gptSoVitsConfig.top_p,
                    temperature: character.gptSoVitsConfig.temperature,
                    speed_factor: character.gptSoVitsConfig.speed,
                    top_k: character.gptSoVitsConfig.top_k,
                    text_split_method: character.gptSoVitsConfig.text_split_method,
                    parallel_infer: true,
                    // media_type: character.gptSoVitsConfig.ref_audio_data.fileName.split('.')[1],
                    ref_free: character.gptSoVitsConfig.use_long_audio || !character.gptSoVitsConfig.use_prompt,
                }

                if (character.gptSoVitsConfig.use_prompt){
                    body.prompt_text = character.gptSoVitsConfig.prompt
                }

                if (character.gptSoVitsConfig.use_auto_path){
                    console.log('auto')
                    const path = await globalFetch(`${character.gptSoVitsConfig.url}/get_path`, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        rawResponse: false,
                        plainFetchDeforce: true,
                    })
                    console.log(path)
                    if(path.ok){
                        body.ref_audio_path = path.data.message + '/public/audio/' + character.gptSoVitsConfig.ref_audio_data.fileName
                    }
                    else{
                        throw new Error('Failed to Auto get path')
                    }
                } else {
                    body.ref_audio_path = character.gptSoVitsConfig.ref_audio_path + '/public/audio/' + character.gptSoVitsConfig.ref_audio_data.fileName
                }
                console.log(body)

                const response = await globalFetch(`${character.gptSoVitsConfig.url}/tts`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: body,
                    rawResponse: true,
                })
                console.log(response)

                if (response.ok) {
                    const audioBuffer = response.data.buffer;
                    audioContext.decodeAudioData(audioBuffer, (decodedData) => {
                        const sourceNode = audioContext.createBufferSource();
                        sourceNode.buffer = decodedData;
                        
                        const gainNode = audioContext.createGain();
                        gainNode.gain.value = character.gptSoVitsConfig.volume || 1.0;
                        
                        sourceNode.connect(gainNode);
                        gainNode.connect(audioContext.destination);
                        
                        sourceNode.start();
                    });
                } else {
                    const textBuffer: Uint8Array = response.data.buffer
                    const text = Buffer.from(textBuffer).toString('utf-8')
                    throw new Error(text);
                }
                break;
            }
            case 'fishspeech':{
                if (character.fishSpeechConfig.model._id === ''){
                    throw new Error('FishSpeech Model is not selected')
                }
                const audioContext = new AudioContext();

                const body = {
                    text: text,
                    reference_id: character.fishSpeechConfig.model._id,
                    chunk_length: character.fishSpeechConfig.chunk_length,
                    normalize: character.fishSpeechConfig.normalize,
                    format: 'mp3',
                    mp3_bitrate: 192,
                }


                console.log(body)

                const response = await globalFetch(`https://api.fish.audio/v1/tts`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${db.fishSpeechKey}`
                    },
                    body: body,
                    rawResponse: true,
                })
                console.log(response)

                if (response.ok) {
                    const audioBuffer = response.data.buffer;
                    audioContext.decodeAudioData(audioBuffer, (decodedData) => {
                        const sourceNode = audioContext.createBufferSource();
                        sourceNode.buffer = decodedData;
                        sourceNode.connect(audioContext.destination);
                        sourceNode.start();
                    });
                } else {
                    const textBuffer: Uint8Array = response.data.buffer
                    const text = Buffer.from(textBuffer).toString('utf-8')
                    throw new Error(text);
                }
                break
            }
            case 'wavespeed':{
                if (character.wavespeedTtsConfig.model === ''){
                    throw new Error('Wavespeed TTS Model is not selected')
                }

                type BaseBody = {
                    language: string;
                    text: string;
                };
                type TextToSpeechBody = BaseBody & {
                    voice: string;
                    style_instruction?: string;
                };
                type VoiceCloneBody = BaseBody & {
                    audio: string;
                };
                type VoiceDesignBody = BaseBody & {
                    voice_description: string;
                };
                type WavespeedBody = TextToSpeechBody | VoiceCloneBody | VoiceDesignBody;

                let body: WavespeedBody;
                if (character.wavespeedTtsConfig.model === 'wavespeed-ai/qwen3-tts/text-to-speech') {
                    body = {
                        language: character.wavespeedTtsConfig.language,
                        text,
                        voice: character.wavespeedTtsConfig.voice,
                        style_instruction: character.wavespeedTtsConfig.style_instruction,
                    };
                } else if (character.wavespeedTtsConfig.model === 'wavespeed-ai/qwen3-tts/voice-clone') {
                    const audio: Uint8Array = await loadAsset(character.wavespeedTtsConfig.reference_audio_id);
                    const base64Audio = btoa(new Uint8Array(audio).reduce((data, byte) => data + String.fromCharCode(byte), ''));
                    body = {
                        language: character.wavespeedTtsConfig.language,
                        text,
                        audio: base64Audio,
                    };
                } else if (character.wavespeedTtsConfig.model === 'wavespeed-ai/qwen3-tts/voice-design') {
                    body = {
                        language: character.wavespeedTtsConfig.language,
                        text,
                        voice_description: character.wavespeedTtsConfig.voice_description,
                    };
                } else {
                    throw new Error(`Unsupported Wavespeed TTS model: ${character.wavespeedTtsConfig.model}`);
                }

                // Request
                // First: submit task
                const requestEndpoint = `https://api.wavespeed.ai/api/v3/${character.wavespeedTtsConfig.model}`
                const requestResponse = await globalFetch(requestEndpoint, {
                    body: body,
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": "Bearer " + db.wavespeedTtsKey
                    }
                })
                let requestId: string;
                if (requestResponse.ok) {
                    /*
                    * submit response:
                    * {
                    *   code: number = HTTP status code (e.g., 200 for success)
                    *   message: string = Status message (e.g., “success”)
                    *   data: {
                    *     id: string = Unique identifier for the prediction, Task Id
                    *   }
                    * }
                    * */
                    requestId = requestResponse.data.data.id
                }
                else {
                    throw new Error(`Submit task failed ${requestResponse.status}: ${requestResponse.data}`)
                }

                // Second: monitor task
                const taskEndpoint = `https://api.wavespeed.ai/api/v3/predictions/${requestId}/result`
                let resultEndpoint: string;
                const POLL_INTERVAL = 1000; // monitor every 1 seconds
                const MAX_WAIT_TIME = 3 * 60 * 1000; // 3 minutes absolute timeout
                const startTime = Date.now();
                while (true) {
                    const elapsedTime = Date.now() - startTime;
                    if (elapsedTime > MAX_WAIT_TIME) {
                        throw new Error(`Task timeout after ${MAX_WAIT_TIME / 1000}s`);
                    }
                    const taskResponse = await globalFetch(taskEndpoint, {
                        method: 'GET',
                        headers: {
                            "Authorization": "Bearer " + db.wavespeedTtsKey
                        }
                    })
                    if (taskResponse.ok) {
                        /*
                        * monitor response:
                        * {
                        *   code: number = HTTP status code (e.g., 200 for success)
                        *   message: string = Status message (e.g., “success”)
                        *   data: {
                        *     status: string = Status of the task: created, processing, completed, or failed
                        *     outputs: string[] = Array of URLs to the generated content (empty when status is not completed)
                        *   }
                        * }
                        * */
                        if (taskResponse.data.data.status === 'completed') {
                            resultEndpoint = taskResponse.data.data.outputs[0]
                            break
                        }
                        else if (taskResponse.data.data.status === 'failed') {
                            throw new Error(JSON.stringify(taskResponse.data))
                        }
                        // else keep loop
                        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
                    }
                    else {
                        throw new Error(JSON.stringify(taskResponse.data))
                    }
                }
                if (!resultEndpoint) {
                    throw new Error('Task finished but no result URL')
                }

                // Third: get result
                const resultResponse = await globalFetch(resultEndpoint, {
                    method: 'GET',
                    headers: {
                        "Authorization": "Bearer " + db.wavespeedTtsKey
                    },
                    rawResponse: true
                })
                if (resultResponse.ok) {
                    // Convert uint8array to arraybuffer
                    const bytes = resultResponse.data as Uint8Array;
                    const audioArrayBuffer: ArrayBuffer =
                        bytes.buffer instanceof ArrayBuffer
                            ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
                            : bytes.slice().buffer;

                    const audioContext = new AudioContext();
                    audioContext.decodeAudioData(audioArrayBuffer, (decodedData) => {
                        sourceNode = audioContext.createBufferSource();
                        sourceNode.buffer = decodedData;
                        sourceNode.connect(audioContext.destination);
                        sourceNode.start();
                    }).then();
                }
                else {
                    throw new Error(JSON.stringify(resultResponse.data))
                }
                break;
            }
        }   
    } catch (error) {
        alertError(`TTS Error: ${error}`)
    }
}



export const oaiVoices = [
    'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'
]

export function stopTTS(){
    if(sourceNode){
        sourceNode.stop()
    }
    if(speechSynthesis && SpeechSynthesisUtterance){
        speechSynthesis.cancel()
    }
}


export function getWebSpeechTTSVoices() {
    return speechSynthesis.getVoices().map(v => {
        return v.name
    })
}

export async function getElevenTTSVoices() {
    let db = getDatabase()

    const data = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: {
            'xi-api-key': db.elevenLabKey || undefined
        }
    })
    const res = await data.json()

    console.log(res)
    return res.voices
}

export async function getVOICEVOXVoices() {
    const db = getDatabase();
    const speakerData = await fetch(`${db.voicevoxUrl}/speakers`)
    const speakerList = await speakerData.json()
    const speakersInfo = speakerList.map((speaker) => {
      const styles = speaker.styles.map((style) => {
        return {name: style.name, id: `${style.id}`}
      })
      return {name: speaker.name, list: JSON.stringify(styles)}
    })
    speakersInfo.unshift({ name: "None", list: null})
    return speakersInfo;
}

export function getNovelAIVoices(){
    return [
        {
            gender: "UNISEX",
            voices: ['Anananan']
        },
        {
            gender: "FEMALE",
            voices: ['Aini', 'Orea', 'Claea', 'Lim', 'Aurae', 'Naia']
        },
        {
            gender: "MALE",
            voices: ['Aulon', 'Elei', 'Ogma', 'Raid', 'Pega', 'Lam']
        }
    ];
}

export function FixNAITTS(data:character){
    if (data.naittsConfig === undefined){
        data.naittsConfig.voice = 'Anananan'
    }

    return data
}
