/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
const {Service}=require("@volcengine/openapi");
async function invokeEnterpriseAsset(input){
 const ak=String(input?.accessKeyId||"").trim(),sk=String(input?.secretKey||"").trim(),group=String(input?.groupId||"").trim(),name=String(input?.name||"").trim(),raw=String(input?.url||"").trim();let source;try{source=new URL(raw)}catch{source=null}
 if(input?.action!=="create"||!ak||!sk||!group||!name||!source||source.protocol!=="https:")throw Object.assign(new Error("企业 CreateAsset 参数不完整"),{statusCode:400});
 try{const service=new Service({host:"ark.cn-beijing.volcengineapi.com",region:"cn-beijing",serviceName:"ark",defaultVersion:"2024-01-01",accessKeyId:ak,secretKey:sk});const call=service.createJSONAPI("CreateAsset",{Version:"2024-01-01",method:"POST"});const data=await call({AssetType:input.assetType||"image",GroupId:group,Name:name,ProjectName:input.projectName||"default",URL:source.href});const id=String(data?.Id||data?.Result?.Id||data?.Result?.AssetId||"");if(!id)throw new Error("方舟未返回 Asset ID");return{id,pending:true}}catch(e){throw Object.assign(new Error(`火山企业 Assets API：${String(e?.message||e).slice(0,400)}`),{statusCode:502,retryable:false})}
}
module.exports={invokeEnterpriseAsset};
