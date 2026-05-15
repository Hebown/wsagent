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