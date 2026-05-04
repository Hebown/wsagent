import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fsApi from '../lib/vscode/file/file-api'; // 注意路径

suite('FileSystem API Test Suite', () => {
    const EMPTY_WORKSPACE_DIR = path.join(__dirname, '/test-workspace');
    const testWorkspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!testWorkspaceRoot) {
        throw new Error('请先打开一个测试文件夹');
    }
    
    const testDir = '.agent-test-data';  // 测试用临时目录

    suiteSetup(async function() {
        // 在所有测试前清理旧的测试数据
        const testDirUri = vscode.Uri.file(path.join(testWorkspaceRoot, testDir));
        try {
            await vscode.workspace.fs.delete(testDirUri, { recursive: true });
        } catch (e) { /* 忽略不存在错误 */ }
    });

    test('createFolder 能创建单层目录', async () => {
        const folderPath = `${testDir}/a`;
        await fsApi.createFolder(folderPath);
        const folderExists = await fsApi.exists(folderPath);
        assert.strictEqual(folderExists, true);
    });

    test('createFolder 能递归创建多级目录', async () => {
        const folderPath = `${testDir}/deep/nested/folder`;
        await fsApi.createFolder(folderPath, true);
        const folderExists = await fsApi.exists(folderPath);
        assert.strictEqual(folderExists, true);
    });

    test('writeFile 写入内容并读取', async () => {
        const filePath = `${testDir}/hello.txt`;
        const content = 'Hello Agent!';
        await fsApi.writeFile(filePath, content);
        const readContent = await fsApi.readFile(filePath);
        assert.strictEqual(readContent, content);
    });

    test('writeFile 不覆盖时抛错', async () => {
        const filePath = `${testDir}/no-overwrite.txt`;
        await fsApi.writeFile(filePath, 'first');
        await assert.rejects(
            async () => {
                await fsApi.writeFile(filePath, 'second', false);
            },
            (err: Error) => err.message.includes('已存在，且你指定了不重写')
        );
    });

    test('exists 对不存在的路径返回 false', async () => {
        const notExist = await fsApi.exists(`${testDir}/i-dont-exist.txt`);
        assert.strictEqual(notExist, false);
    });

    test('listDirectory 列出目录内容', async () => {
        const dirPath = `${testDir}/for-list`;
        await fsApi.createFolder(dirPath);
        await fsApi.writeFile(`${dirPath}/file1.txt`, 'one');
        await fsApi.writeFile(`${dirPath}/file2.txt`, 'two');
        const entries = await fsApi.listDirectory(dirPath);
        const fileNames = entries.map(e => e.name);
        assert.ok(fileNames.includes('file1.txt'));
        assert.ok(fileNames.includes('file2.txt'));
        assert.strictEqual(entries.length, 2);
    });

    test('deleteFileOrFolder 删除文件', async () => {
        const filePath = `${testDir}/to-delete.txt`;
        await fsApi.writeFile(filePath, 'delete me');
        await fsApi.deleteFileOrFolder(filePath);
        const stillExists = await fsApi.exists(filePath);
        assert.strictEqual(stillExists, false);
    });

    test('ensureFile 自动创建父目录', async () => {
        const filePath = `${testDir}/ensure/parent/new.txt`;
        const content = 'ensured';
        await fsApi.ensureFile(filePath, content);
        const exists = await fsApi.exists(filePath);
        assert.strictEqual(exists, true);
        const read = await fsApi.readFile(filePath);
        assert.strictEqual(read, content);
    });
});