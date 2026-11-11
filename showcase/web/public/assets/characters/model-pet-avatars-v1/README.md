# 排名静态头像的裁切来源

这些 512×512 透明 PNG 是从已审定的 `model-pets-v2` 静态角色图确定性裁切得到的头像特写，没有调用生成模型或重绘。Sam Altman、Dario Amodei、Qwen、梁文锋使用头像裁切；Kimi 直接使用原完整圆球静态图。

为避免头脸或抬手贴边，Sam Altman 使用源图裁切框 `(340, 70, 680, 410)`，Dario Amodei 使用 `(310, 70, 710, 470)`；两者均以 nearest-neighbor 归一化为 512×512。其余头像沿用既有裁切。
