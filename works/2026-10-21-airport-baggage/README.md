# 货站工艺演示

这个分支的默认入口展示机场货站的物流设备。选取左侧工艺区域，可以观看包裹分拣、滑槽卸载、空托盘输送，以及装卸交接和组板工位。选择「主站房位置对照」查看各组设备的相对位置。

「图纸叠合」把模型中心线和设备轮廓绘在本地项目图纸上。「工艺原图」显示同一视角的图纸局部。三维视图可以旋转、缩放、定位设备、暂停和调整倍速。动作由本地程序驱动。

## 运行

以下命令在本作品的 `src` 目录下运行。新电脑需要 Node.js 和本地项目配套 ZIP。解压到 `src`，使 `public/project-layout/layout.json`、同目录的 PNG 和 `public/simready/` 中的模型就位。

```powershell
npm ci
npm run assets -- --check
npm run dev
```

打开 [本机货站演示](http://127.0.0.1:5426/)。若需重新准备模型，执行 `npm run assets -- --download`，或用 `npm run assets -- "模型库目录"` 从本地带有 `glb` 子目录的资产库复制。准备程序按锁定版本和 SHA-256 校验文件，已校验的文件可以复用。两个演示共用七份模型，货站入口加载其中的纸箱、木托盘和直线滚筒。

发布版本在同一目录运行 `npm run build` 和 `npm run preview`，地址和开发版相同。两种启动命令共用同一端口，每次运行一种。打开页面后会显示项目名称。若看到项目资料缺失提示，补齐配套资料后重新加载。

## 验证和录像

先启动本机服务。在安装了 Playwright Chromium 的环境中运行 `node check_cargo.mjs`，结果和各视图截图写入 `evidence/cargo`。录制演示使用 `node record_cargo.mjs`，需要可从命令行调用 FFmpeg。可以传入一个新 MP4 文件路径。不同连接地址可通过 `AIRPORT_URL` 设置。

设备图纸、坐标、实测结果、截图和影片随本机项目资料交付。源码中的注册、模型显示和回放使用米为单位。施工定位和设备选型以项目正式设计文件为准。

## 来源

货站按项目工艺图建模，借用的纸箱、木托盘和直线滚筒保留原始 GLB。场景对资产做了尺度适配，并驱动滚筒转动。资产由 NVIDIA 制作，CodePawl 转为 GLB，版本和逐文件校验值见 `src/src/simready-assets.json`。[NVIDIA 原始资产](https://huggingface.co/datasets/nvidia/simready-assets) · [CodePawl 转换版本](https://huggingface.co/datasets/codepawl/simready-glb/tree/d529a9403ea062d57b3c0c5d7c01473b0db0beef) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

原仓库的旅客行李项目仍可通过 [行李演示入口](http://127.0.0.1:5426/?project=bagline) 打开。原作者使用 visualize-in-3d、Three.js、React Three Fiber 和 Blender 制作了值机、分拣和机坪场景，原始设备资料和提示记录见 `design/` 与 `prompts.md`。代码沿用仓库的 MIT 许可。[原作发布记录](https://x.com/anxuanng/status/2112964456745763191) · [visualize-in-3d](https://github.com/codepawl/viz3d) · [代码许可](../../LICENSE)
