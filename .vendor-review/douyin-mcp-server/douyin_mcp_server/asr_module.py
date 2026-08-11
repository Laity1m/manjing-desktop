#!/usr/bin/env python3
"""
Qwen-3-ASR-Flash 语音识别模块

支持功能：
1. URL 和本地音频文件识别
2. 上下文增强提高识别准确率
3. 多语言识别
4. 语种检测
"""

import os
import dashscope
from typing import Optional, Union
from pathlib import Path


class QwenASR:
    """Qwen-3-ASR-Flash 语音识别器"""
    
    def __init__(self, api_key: Optional[str] = None, model: str = "qwen3-asr-flash"):
        """
        初始化ASR识别器
        
        参数:
        - api_key: 阿里云百炼API密钥，如果不提供则从环境变量获取
        - model: 使用的模型，默认为 qwen3-asr-flash
        """
        self.api_key = api_key or os.getenv('DASHSCOPE_API_KEY')
        if not self.api_key:
            raise ValueError("未设置 DASHSCOPE_API_KEY，请在环境变量中设置或传入 api_key 参数")
        
        self.model = model
        dashscope.api_key = self.api_key
    
    def recognize_audio(
        self,
        audio_input: Union[str, Path],
        context: Optional[str] = None,
        language: Optional[str] = None,
        enable_lid: bool = True,
        enable_itn: bool = False
    ) -> dict:
        """
        识别音频中的文本
        
        参数:
        - audio_input: 音频输入，可以是URL链接或本地文件路径
        - context: 上下文文本，用于提高识别准确率
        - language: 指定语言代码（如 'zh', 'en'），可选
        - enable_lid: 是否启用语种识别，默认True
        - enable_itn: 是否启用逆文本规范化，默认False
        
        返回:
        - dict: 包含识别结果的字典
        """
        try:
            # 处理输入路径
            if isinstance(audio_input, Path):
                audio_input = str(audio_input)
            
            # 如果是本地文件，需要添加 file:// 前缀
            if os.path.exists(audio_input):
                audio_input = f"file://{os.path.abspath(audio_input)}"
            
            # 构建消息
            messages = [
                {
                    "role": "system",
                    "content": [
                        {"text": context or ""}
                    ]
                },
                {
                    "role": "user", 
                    "content": [
                        {"audio": audio_input}
                    ]
                }
            ]
            
            # 配置ASR选项
            asr_options = {
                "enable_lid": enable_lid,
                "enable_itn": enable_itn
            }
            
            if language:
                asr_options["language"] = language
            
            # 调用API
            response = dashscope.MultiModalConversation.call(
                api_key=self.api_key,
                model=self.model,
                messages=messages,
                result_format="message",
                asr_options=asr_options
            )
            
            if response.status_code != 200:
                raise Exception(f"API调用失败: {response.message}")
            
            # 解析结果
            result = {
                "success": True,
                "text": "",
                "language": None,
                "usage": response.usage,
                "request_id": response.request_id
            }
            
            if response.output and response.output.choices:
                choice = response.output.choices[0]
                if choice.message and choice.message.content:
                    result["text"] = choice.message.content[0].get("text", "")
                
                # 提取语言信息
                if choice.message.annotations:
                    for annotation in choice.message.annotations:
                        if annotation.get("type") == "audio_info":
                            result["language"] = annotation.get("language")
            
            return result
            
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "text": "",
                "language": None
            }
    
    def recognize_url(
        self,
        audio_url: str,
        context: Optional[str] = None,
        language: Optional[str] = None,
        enable_lid: bool = True,
        enable_itn: bool = False
    ) -> dict:
        """
        识别在线音频URL中的文本
        
        参数:
        - audio_url: 音频URL链接
        - context: 上下文文本，用于提高识别准确率
        - language: 指定语言代码（如 'zh', 'en'），可选
        - enable_lid: 是否启用语种识别，默认True
        - enable_itn: 是否启用逆文本规范化，默认False
        
        返回:
        - dict: 包含识别结果的字典
        """
        return self.recognize_audio(
            audio_input=audio_url,
            context=context,
            language=language,
            enable_lid=enable_lid,
            enable_itn=enable_itn
        )
    
    def recognize_file(
        self,
        file_path: Union[str, Path],
        context: Optional[str] = None,
        language: Optional[str] = None,
        enable_lid: bool = True,
        enable_itn: bool = False
    ) -> dict:
        """
        识别本地音频文件中的文本
        
        参数:
        - file_path: 本地音频文件路径
        - context: 上下文文本，用于提高识别准确率
        - language: 指定语言代码（如 'zh', 'en'），可选
        - enable_lid: 是否启用语种识别，默认True
        - enable_itn: 是否启用逆文本规范化，默认False
        
        返回:
        - dict: 包含识别结果的字典
        """
        if isinstance(file_path, str):
            file_path = Path(file_path)
        
        if not file_path.exists():
            return {
                "success": False,
                "error": f"文件不存在: {file_path}",
                "text": "",
                "language": None
            }
        
        return self.recognize_audio(
            audio_input=file_path,
            context=context,
            language=language,
            enable_lid=enable_lid,
            enable_itn=enable_itn
        )


def create_asr_instance(api_key: Optional[str] = None, model: str = "qwen3-asr-flash") -> QwenASR:
    """
    创建ASR识别器实例的便捷函数
    
    参数:
    - api_key: API密钥，可选
    - model: 模型名称，默认为 qwen3-asr-flash
    
    返回:
    - QwenASR: ASR识别器实例
    """
    return QwenASR(api_key=api_key, model=model)