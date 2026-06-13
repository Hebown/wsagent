/*
    本文件封装各种vscode的文件操作
*/
import * as path from 'path';
import * as vscode from 'vscode';


export function getWorkspaceRoot():vscode.Uri{
    const folders=vscode.workspace.workspaceFolders;
    if(!folders||folders.length===0){
        throw new Error('未打开任何文件夹/工作区');
    }
    return folders[0].uri;
}


function resolveUri(input_path:string):vscode.Uri{
    const root=getWorkspaceRoot();
    if(path.isAbsolute(input_path)){
        return vscode.Uri.file(input_path);
    }else{
        return vscode.Uri.joinPath(root,input_path);
    }
}

// 创建文件夹
export async function createFolder(folderPath:string,recursive:boolean=true):Promise<void>{
    const uri=resolveUri(folderPath);
    try{
        await vscode.workspace.fs.createDirectory(uri);
        console.log(`[Agent] 文件夹创建成功: ${uri.fsPath}`);
    }catch(error:any){
        if(recursive && error?.message?.includes('ENOENT')){
            const dirs:string[]=folderPath.split('/');
            let currentPath:string='';
            for(const dir of dirs){
                currentPath=currentPath?`${currentPath}/${dir}`:dir;
                const currentUri:vscode.Uri=resolveUri(currentPath);
                try{
                    await vscode.workspace.fs.createDirectory(currentUri);
                }catch(err:any){
                    if(err?.message?.includes('EEXIST')){
                        continue;
                    }
                    throw err;
                }
            }
        }else{
            throw new Error(`创建文件夹失败:${folderPath}，原因：${error?.message||String(error)}`);
        }
    }
}

// 判断文件是否存在
export async function exists(targetPath: string): Promise<boolean> {
    const uri: vscode.Uri = resolveUri(targetPath);
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch (error: any) {
        // 文件不存在时 stat 会抛出错误
        return false;
    }
}

export async function writeFile(filePath:string,content:string,overwrite:boolean=true):Promise<void>{
    const uri:vscode.Uri=resolveUri(filePath);
    const existsFlag:boolean=await exists(filePath);
    if(existsFlag && !overwrite){
        throw new Error(`文件 ${filePath} 已存在，且你指定了不重写`);
    }
    const uint8Array:Uint8Array=new TextEncoder().encode(content);
    try{
        await vscode.workspace.fs.writeFile(uri,uint8Array);
        console.log(`[Agent] 文件写入成功: ${uri.fsPath}, 长度: ${uint8Array.length} 字节`);
    }catch(error:any){
        throw new Error(`写入文件失败: ${filePath}，原因: ${error?.message || String(error)}`);
    }
}

export async function readFile(filePath: string): Promise<string> {
    const uri: vscode.Uri = resolveUri(filePath);
    try {
        const uint8Array: Uint8Array = await vscode.workspace.fs.readFile(uri);
        const content: string = new TextDecoder().decode(uint8Array);
        return content;
    } catch (error: any) {
        throw new Error(`读取文件失败: ${filePath}，原因: ${error?.message || String(error)}`);
    }
}

export async function listDirectory(dirPath: string): Promise<Array<{ name: string; path: string; isDirectory: boolean }>> {
    const uri: vscode.Uri = resolveUri(dirPath);
    try {
        const entries: [string, vscode.FileType][] = await vscode.workspace.fs.readDirectory(uri);
        return entries.map(([name, type]) => ({
            name,
            path: path.join(dirPath, name),
            isDirectory: type === vscode.FileType.Directory
        }));
    } catch (error: any) {
        throw new Error(`读取目录失败: ${dirPath}，原因: ${error?.message || String(error)}`);
    }
}

export async function deleteFileOrFolder(targetPath: string, recursive: boolean = false): Promise<void> {
    const uri: vscode.Uri = resolveUri(targetPath);
    try {
        await vscode.workspace.fs.delete(uri, { recursive });
        console.log(`[Agent] 删除成功: ${uri.fsPath}`);
    } catch (error: any) {
        throw new Error(`删除失败: ${targetPath}，原因: ${error?.message || String(error)}`);
    }
}


export async function ensureFile(filePath: string, content: string, overwrite: boolean = true): Promise<void> {
    const dir: string = path.dirname(filePath);
    if (dir !== '.' && dir !== '/') {
        // 检查目录是否存在，不存在则创建
        const dirExists: boolean = await exists(dir);
        if (!dirExists) {
            await createFolder(dir, true);
        }
    }
    await writeFile(filePath, content, overwrite);
}

/**
 * 替换文件中的指定文本（纯文本替换，非正则）。
 * @param filePath 文件路径
 * @param searchText 要搜索的文本
 * @param replaceText 替换后的文本
 * @param occurrence 指定替换第几次出现（0=替换所有，1=替换第1次，2=替换第2次...）
 * @returns 操作结果描述
 */
export async function replaceInFile(filePath: string, searchText: string, replaceText: string, occurrence: number = 0): Promise<string> {
    const content = await readFile(filePath);
    let newContent: string;
    let replaceCount: number = 0;

    if (occurrence > 0) {
        // 替换第 N 次出现
        let startPos = 0;
        let foundPos = -1;
        for (let i = 0; i < occurrence; i++) {
            foundPos = content.indexOf(searchText, startPos);
            if (foundPos === -1) break;
            startPos = foundPos + searchText.length;
        }
        if (foundPos !== -1) {
            newContent = content.slice(0, foundPos) + replaceText + content.slice(foundPos + searchText.length);
            replaceCount = 1;
        } else {
            newContent = content;
        }
    } else {
        // 替换所有出现（转义正则特殊字符）
        const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'g');
        newContent = content.replace(regex, replaceText);
        replaceCount = (content.match(regex) || []).length;
    }

    if (newContent !== content) {
        await writeFile(filePath, newContent, true);
        return `文件 "${filePath}" 中的文本替换完成，共替换了 ${replaceCount} 处。`;
    } else {
        return `文件 "${filePath}" 中未找到目标文本 "${searchText}"，未做任何修改。`;
    }
}

/**
 * 向文件末尾追加内容（如果文件不存在则创建）。
 * 这是解决模型输出截断问题的核心工具——可以分多次追加内容到同一个文件。
 * @param filePath 文件路径
 * @param content 要追加的内容
 * @param ensureNewline 是否在追加前确保文件末尾有换行（默认 true）
 * @returns 操作结果描述
 */
export async function appendToFile(filePath: string, content: string, ensureNewline: boolean = true): Promise<string> {
    const fileExists = await exists(filePath);
    let finalContent: string;

    if (!fileExists) {
        // 文件不存在，先创建父目录，再写入内容
        const dir = path.dirname(filePath);
        if (dir !== '.' && dir !== '/') {
            const dirExists = await exists(dir);
            if (!dirExists) {
                await createFolder(dir, true);
            }
        }
        await writeFile(filePath, content, true);
        return `文件 "${filePath}" 已创建并写入内容（${content.length} 字符）。`;
    } else {
        // 文件已存在，读取原内容并追加
        const existingContent = await readFile(filePath);
        if (ensureNewline && !existingContent.endsWith('\n')) {
            finalContent = existingContent + '\n' + content;
        } else {
            finalContent = existingContent + content;
        }
        await writeFile(filePath, finalContent, true);
        return `文件 "${filePath}" 已追加 ${content.length} 字符（总长度 ${finalContent.length} 字符）。`;
    }
}

/**
 * 获取文件大小信息（字节数和字符数）。
 * 用于检查文件是否完整写入，辅助分块续写策略。
 * @param filePath 文件路径
 * @returns 文件信息描述
 */
export async function getFileInfo(filePath: string): Promise<string> {
    const uri = resolveUri(filePath);
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        const content = await readFile(filePath);
        return `文件 "${filePath}" 信息：
  - 大小: ${stat.size} 字节
  - 字符数: ${content.length}
  - 行数: ${content.split('\n').length}
  - 最后修改: ${new Date(stat.mtime).toISOString()}`;
    } catch (error: any) {
        return `文件 "${filePath}" 不存在或无法读取。`;
    }
}
