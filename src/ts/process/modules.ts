import { language } from "src/lang"
import { alertClear, alertConfirm, alertError, alertModuleSelect, alertNormal, alertStore, alertWait } from "../alert"
import { getCurrentCharacter, getCurrentChat, getDatabase, setCurrentCharacter, setDatabase, type customscript, type loreBook, type triggerscript } from "../storage/database.svelte"
import { AppendableBuffer, downloadFile, forageStorage, readImage, saveAsset, LocalWriter, VirtualWriter } from "../globalApi.svelte"
import { selectSingleFile, sleep } from "../util"
import { v4 } from "uuid"
import { convertExternalLorebook } from "./lorebook.svelte"
import { compressImage, getImageType } from '../media'
import { decodeRPack, encodeRPack } from "../rpack/rpack_js"
import { DBState, HideIconStore, moduleBackgroundEmbedding, ReloadGUIPointer } from "../stores.svelte"
import {get} from "svelte/store"
import { CharXWriter } from "./processzip"
import { PngChunk } from "../pngChunk"

export interface MCPModule{
    url: string
}

export interface RisuModule{
    name: string
    description: string
    lorebook?: loreBook[]
    regex?: customscript[]
    cjs?: string
    trigger?: triggerscript[]
    id: string
    lowLevelAccess?: boolean
    hideIcon?: boolean
    backgroundEmbedding?:string
    assets?:[string,string,string][]
    namespace?:string
    customModuleToggle?:string
    mcp?:MCPModule
}

export async function exportModule(module:RisuModule, arg:{
    alertEnd?:boolean
    saveData?:boolean
    type?:'risum'|'charx'
    writer?:LocalWriter|VirtualWriter|CharXWriter
} = {}){
    const alertEnd = arg.alertEnd ?? true
    const saveData = arg.saveData ?? true
    const type = arg.type ?? 'risum'

    // charx 模式：使用 ZIP 格式，可直接查看媒體檔案
    if(type === 'charx'){
        return await exportModuleCharX(module, arg)
    }

    // risum 模式：原有的二進制格式
    const apb = new AppendableBuffer()
    const writeLength = (len:number) => {
        const lenbuf = Buffer.alloc(4)
        lenbuf.writeUInt32LE(len, 0)
        apb.append(lenbuf)
    }
    const writeByte = (byte:number) => {
        //byte is 0-255
        const buf = Buffer.alloc(1)
        buf.writeUInt8(byte, 0)
        apb.append(buf)
    }

    const assets = module.assets ?? []
    module = safeStructuredClone(module)
    module.assets ??= []
    module.assets = module.assets.map((asset) => {
        return [asset[0], '', asset[2]] as [string,string,string]
    })

    const mainbuf = await encodeRPack(Buffer.from(JSON.stringify({
        module: module,
        type: 'risuModule'
    }, null, 2), 'utf-8'))

    writeByte(111) //magic number
    writeByte(0) //version
    writeLength(mainbuf.length)
    apb.append(mainbuf)

    for(let i=0;i<assets.length;i++){
        const asset = assets[i]
        writeByte(1) //mark as asset
        alertStore.set({
            type: 'wait',
            msg: `Loading... (Adding Assets ${i} / ${assets.length})`
        })
        let rData = await readImage(asset[1])
        if(!rData){
            rData = new Uint8Array(0) //blank buffer
        }
        let encoded = await encodeRPack(Buffer.from(await compressImage(rData)))
        writeLength(encoded.length)
        apb.append(encoded)
    }

    writeByte(0) //end of file

    if(saveData){
        await downloadFile(module.name + '.risum', apb.buffer)
    }
    if(alertEnd){
        alertNormal(language.successExport)
    }

    return apb.buffer
}

/**
 * 以 charx (ZIP) 格式導出模組，可直接打開查看媒體檔案
 */
async function exportModuleCharX(module:RisuModule, arg:{
    alertEnd?:boolean
    saveData?:boolean
    writer?:LocalWriter|VirtualWriter|CharXWriter
} = {}){
    const alertEnd = arg.alertEnd ?? true
    const saveData = arg.saveData ?? true

    // 如果傳入的是 CharXWriter，直接使用；否則創建新的
    let writer:CharXWriter
    let needInit = false
    
    if(arg.writer instanceof CharXWriter){
        writer = arg.writer
    }
    else{
        const localWriter = arg.writer ?? (new LocalWriter())
        if(!arg.writer && saveData){
            await (localWriter as LocalWriter).init('Module CharX File', ['charx'])
        }
        writer = new CharXWriter(localWriter)
        needInit = true
        await writer.init()
    }

    const assets = module.assets ?? []
    module = safeStructuredClone(module)
    module.assets ??= []
    module.assets = module.assets.map((asset) => {
        return [asset[0], '', asset[2]] as [string,string,string]
    })

    // 寫入模組 JSON
    await writer.write("module.json", Buffer.from(JSON.stringify({
        module: module,
        type: 'risuModule'
    }, null, 2), 'utf-8'))

    // 寫入資產
    const seenPaths = new Set<string>()
    for(let i=0;i<assets.length;i++){
        const asset = assets[i]
        alertStore.set({
            type: 'progress',
            msg: `Loading... (Adding Assets)`,
            submsg: ((i + 1) / assets.length * 100).toFixed(2)
        })

        let rData = await readImage(asset[1])
        if(!rData){
            continue
        }

        // 解析資產類型和擴展名
        const assetName = asset[0] || `asset_${i + 1}`
        const assetExt = asset[2] || 'png'
        const imageType = getImageType(rData)

        // 確定資產類型目錄
        let itype = 'other'
        switch(assetExt.toLowerCase()){
            case 'png':
            case 'jpg':
            case 'jpeg':
            case 'gif':
            case 'webp':
            case 'avif':
                itype = 'image'
                break
            case 'mp3':
            case 'wav':
            case 'ogg':
            case 'flac':
                itype = 'audio'
                break
            case 'mp4':
            case 'webm':
            case 'mov':
            case 'avi':
            case 'mkv':
                itype = 'video'
                break
            case 'mmd':
            case 'obj':
                itype = 'model'
                break
            case 'safetensors':
            case 'cpkt':
            case 'onnx':
                itype = 'ai'
                break
            case 'otf':
            case 'ttf':
            case 'woff':
            case 'woff2':
                itype = 'fonts'
                break
            case 'js':
            case 'ts':
            case 'lua':
                itype = 'code'
                break
        }

        // 生成唯一路徑
        let name = assetName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/, '')
        if(name.length > 100){
            name = name.substring(0, 100)
        }
        const ext = assetExt === 'unknown' ? 'png' : assetExt
        const baseDir = assetExt === 'unknown' ? `assets/image` : `assets/${itype}`

        let uniqueName = name
        let suffix = 0
        while(seenPaths.has(`${baseDir}/${uniqueName}.${ext}`)){
            suffix++
            uniqueName = `${name}_${suffix}`
        }
        const path = `${baseDir}/${uniqueName}.${ext}`
        seenPaths.add(path)

        // 寫入元數據（PNG 文件）
        const metaPath = `x_meta/${uniqueName}.json`
        if(imageType === 'PNG'){
            const metadatas:Record<string,string> = {}
            try {
                const gen = PngChunk.readGenerator(rData)
                for await (const chunk of gen){
                    if(!chunk || chunk instanceof AppendableBuffer){
                        continue
                    }
                    metadatas[chunk.key] = chunk.value
                }
            } catch (error) {
                // 忽略 PNG 解析錯誤
            }
            if(Object.keys(metadatas).length > 0){
                await writer.write(metaPath, Buffer.from(JSON.stringify(metadatas, null, 4)), 6)
            }
            else{
                await writer.write(metaPath, Buffer.from(JSON.stringify({
                    'type': imageType
                }), 'utf-8'), 6)
            }
        }
        else{
            await writer.write(metaPath, Buffer.from(JSON.stringify({
                'type': imageType
            }), 'utf-8'), 6)
        }

        // 寫入資產文件
        await writer.write(path, Buffer.from(await compressImage(rData)))
    }

    // 只有當我們創建了 writer 時才結束它
    if(needInit){
        await writer.end()
        if(saveData && !arg.writer){
            alertNormal(language.successExport)
        }
    }

    return new Uint8Array(0)
}

export async function readModule(buf:Buffer):Promise<RisuModule> {
    let pos = 0

    const readLength = () => {
        const len = buf.readUInt32LE(pos)
        pos += 4
        return len
    }
    const readByte = () => {
        const byte = buf.readUInt8(pos)
        pos += 1
        return byte
    }
    const readData = (len:number) => {
        const data = buf.subarray(pos, pos + len)
        pos += len
        return data
    }

    if(readByte() !== 111){
        console.error("Invalid magic number")
        alertError(language.errors.noData)
        return
    }
    if(readByte() !== 0){ //Version check
        console.error("Invalid version")
        alertError(language.errors.noData)
        return
    }

    const mainLen = readLength()
    const mainData = readData(mainLen)
    const main:{
        type:'risuModule'
        module:RisuModule
    } = JSON.parse(Buffer.from(await decodeRPack(mainData)).toString())

    if(main.type !== 'risuModule'){
        console.error("Invalid module type")
        alertError(language.errors.noData)
        return
    }

    let module = main.module

    const maxConcurrentAssetSaves = 10
    const retryDelayMs = 5000
    const maxRetries = 3
    const totalAssets = module.assets?.length ?? 0
    let completed = 0

    type AssetTask = {
        index: number
        data: Uint8Array
    }

    const runAssetTasks = async (tasks: AssetTask[]) => {
        if (tasks.length === 0) {
            return []
        }
        const inFlight = new Set<Promise<void>>()
        const failed: AssetTask[] = []
        const runTask = (task: AssetTask) => {
            const promise = (async () => {
                try {
                    const decoded = await decodeRPack(task.data)
                    if (!module.assets?.[task.index]) {
                        throw new Error(`Missing asset metadata for index ${task.index}`)
                    }
                    module.assets[task.index][1] = await saveAsset(decoded)
                    completed += 1
                } catch (error) {
                    failed.push(task)
                } finally {
                    alertWait(`Loading... (Adding Assets ${completed} / ${totalAssets})`)
                }
            })()
            inFlight.add(promise)
            promise.finally(() => inFlight.delete(promise))
        }

        for (const task of tasks) {
            while (inFlight.size >= maxConcurrentAssetSaves) {
                await Promise.race(inFlight)
            }
            runTask(task)
        }

        await Promise.all(inFlight)
        return failed
    }

    const tasks: AssetTask[] = []
    let i = 0
    while(true){
        const mark = readByte()
        if(mark === 0){
            break
        }
        if(mark !== 1){
            alertError(language.errors.noData)
            return
        }
        const len = readLength()
        const data = readData(len)
        tasks.push({
            index: i,
            data
        })
        i++
    }

    try {
        let failed = await runAssetTasks(tasks)
        let retryCount = 0
        while (failed.length > 0 && retryCount < maxRetries) {
            await sleep(retryDelayMs)
            retryCount += 1
            failed = await runAssetTasks(failed)
        }
        if (failed.length > 0) {
            throw new Error(`Failed to save ${failed.length} assets`)
        }
    } finally {
        alertClear()
    }

    module.id = v4()
    return module
}

export async function importModule(){
    const f = await selectSingleFile(['json', 'lorebook', 'risum'])
    if(!f){
        return
    }
    let fileData = f.data
    if(f.name.endsWith('.risum')){
        try {
            const buf = Buffer.from(fileData)
            const module = await readModule(buf)
            DBState.db.modules.push(module)
        } catch (error) {
            console.error(error)
            alertError(language.errors.noData)
        }
        return
    }
    try {
        const importData = JSON.parse(Buffer.from(fileData).toString())
        if(importData.type === 'risuModule'){
            if(
                (!importData.name)
                || (!importData.id)
            ){
                alertError(language.errors.noData)
                return
            }
            importData.id = v4()

            if(importData.lowLevelAccess){
                const conf = await alertConfirm(language.lowLevelAccessConfirm)
                if(!conf){
                    return false
                }
            }
            DBState.db.modules.push(importData)
            return
        }
        // importData.type === 'risu' in conflict with HypaV3 preset exports
        // difference: record vs. array
        if(importData.type === 'risu' && importData.data && Array.isArray(importData.data)){
            const lores:loreBook[] = importData.data
            const importModule = {
                name: importData.name || 'Imported Lorebook',
                description: importData.description || 'Converted from risu lorebook',
                lorebook: lores,
                id: v4()
            }
            DBState.db.modules.push(importModule)
            return
        }
        if(importData.entries){
            const lores:loreBook[] = convertExternalLorebook(importData.entries)
            const importModule = {
                name: importData.name || 'Imported Lorebook',
                description: importData.description || 'Converted from external lorebook',
                lorebook: lores,
                id: v4()
            }
            DBState.db.modules.push(importModule)
            return
        }
        if(importData.type === 'regex'  && importData.data){
            const regexs:customscript[] = importData.data
            const importModule = {
                name: importData.name || 'Imported Regex',
                description: importData.description || 'Converted from risu regex',
                regex: regexs,
                id: v4()
            }
            DBState.db.modules.push(importModule)
            return
        }
    } catch (error) {
        console.error(error)
    }

    alertNormal(language.errors.noData)
}

function getModuleById(id:string){
    const db = getDatabase()
    for(let i=0;i<db.modules.length;i++){
        if(db.modules[i].id === id){
            return db.modules[i]
        }
    }
    return null
}

function getModuleByIds(ids:string[]){
    const db = getDatabase()
    const idSet = new Set(ids)
    const modules = db.modules.filter(m => 
        idSet.has(m.id) || (m.namespace && idSet.has(m.namespace))
    )
    return deduplicateModuleById(modules)
}

function deduplicateModuleById(modules:RisuModule[]){
    let ids:string[] = []
    let newModules:RisuModule[] = []
    for(let i=0;i<modules.length;i++){
        if(ids.includes(modules[i].id)){
            continue
        }
        ids.push(modules[i].id)
        newModules.push(modules[i])
    }
    return newModules
}

let lastModules = ''
let lastModuleData:RisuModule[] = []
export function getModules(){
    const currentChat = getCurrentChat()
    const character = getCurrentCharacter()
    const db = getDatabase()
    let ids = db.enabledModules ?? []
    if (currentChat){
        ids = ids.concat(currentChat.modules ?? [])
    }
    if(character && character.modules){
        ids = ids.concat(character.modules)
    }
    if(db.moduleIntergration){
        const intList = db.moduleIntergration.split(',').map((s) => s.trim())
        ids = ids.concat(intList)
    }
    const idsJoined = ids.join('-')
    if(lastModules === idsJoined){
        return lastModuleData
    }

    let modules:RisuModule[] = getModuleByIds(ids)
    lastModules = idsJoined
    lastModuleData = modules
    return modules

}


export function getModuleLorebooks() {
    const modules = getModules()
    let lorebooks: loreBook[] = []
    for (const module of modules) {
        if(!module){
            continue
        }
        if (module.lorebook) {
            lorebooks = lorebooks.concat(module.lorebook)
        }
    }
    return lorebooks
}

export function getModuleAssets() {
    const modules = getModules()
    let assets: [string,string,string][] = []
    for (const module of modules) {
        if(!module){
            continue
        }
        if (module.assets) {
            assets = assets.concat(module.assets)
        }
    }
    return assets
}


export function getModuleTriggers() {
    const modules = getModules()
    let triggers: triggerscript[] = []
    for (const module of modules) {
        if(!module){
            continue
        }
        if (module.trigger) {
            triggers = triggers.concat(module.trigger.map((t) => {
                t.lowLevelAccess = module.lowLevelAccess
                return t
            }))
        }
    }
    return triggers
}

export function getModuleRegexScripts() {
    const modules = getModules()
    let customscripts: customscript[] = []
    for (const module of modules) {
        if(!module){
            continue
        }
        if (module.regex) {
            customscripts = customscripts.concat(module.regex)
        }
    }
    return customscripts
}

export function getModuleToggles() {
    const modules = getModules()
    let costomModuleToggles: string = ''
    for (const module of modules) {
        if(!module){
            continue
        }
        if (module.customModuleToggle) {
            costomModuleToggles += '\n' + module.customModuleToggle + '\n'
        }
    }
    return costomModuleToggles
}

export function getModuleMcps() {
    const modules = getModules()

    return modules.map((v) => v.mcp?.url).filter((v) => v)
}

export async function applyModule() {
    const sel = await alertModuleSelect()
    if (!sel) {
        return
    }

    const module = safeStructuredClone(getModuleById(sel))
    if (!module) {
        return
    }

    const currentChar = getCurrentCharacter()
    if (!currentChar) {
        return
    }
    if(currentChar.type === 'group'){
        return
    }

    if (module.lorebook) {
        for (const lore of module.lorebook) {
            currentChar.globalLore.push(lore)
        }
    }
    if (module.regex) {
        for (const regex of module.regex) {
            currentChar.customscript.push(regex)
        }
    }
    if (module.trigger) {
        for (const trigger of module.trigger) {
            currentChar.triggerscript.push(trigger)
        }
    }

    setCurrentCharacter(currentChar)

    alertNormal(language.successApplyModule)
}

let lastModuleIds:string = ''

export function moduleUpdate(){


    const m = getModules()

    const ids = m.map((m) => m.id).join('-')
    
    let moduleHideIcon = false
    let backgroundEmbedding = ''
    m.forEach((module) => {
        if(!module){
            return
        }

        if(module.hideIcon){
            moduleHideIcon = true
        }
        if(module.backgroundEmbedding){
            backgroundEmbedding += '\n' + module.backgroundEmbedding + '\n'
        }
    })

    if(backgroundEmbedding){
        moduleBackgroundEmbedding.set(backgroundEmbedding)
    }
    HideIconStore.set(getCurrentCharacter()?.hideChatIcon || moduleHideIcon)

    if(lastModuleIds !== ids){
        ReloadGUIPointer.set(get(ReloadGUIPointer) + 1)
        lastModuleIds = ids
    }
}

export function refreshModules(){
    lastModules = ''
    lastModuleData = []
}
