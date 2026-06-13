# wsagent
本项目是作者上网安原理与实践这门课的bonus。由于效果还不错，自己也在用，特多次更新以便提升自己的使用体验。

# 项目概念
本项目是一个 vscode 插件，release 中提供了 vsix 安装方法，具体如何安装这里不展开。

本项目为 vscode 的 chatParticipant 注册了一个以 deepseek 为模型提供方的 agent，你只需要在 聊天对话框中 @WSAgent，即可与之对话。

# 使用说明
本项目需要你在工作区下根目录下创建 .env 文件，内填你自己的 DEEPSEEK_API_KEY 的 value。


# 声明
本项目并不精致，可能存在问题。

本项目并未主动做任何安全防护。

# 未来
本项目未来可能尝试的内容：
- 创建自己的 webview 界面，不再注册到 chatParticipant；
- 支持更多模型

