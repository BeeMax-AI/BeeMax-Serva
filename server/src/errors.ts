export class AppError extends Error { constructor(public status:number,public code:string,message:string){super(message);} }
export function requireValue(condition:unknown,message:string,status=400):asserts condition {if(!condition)throw new AppError(status,status===403?'FORBIDDEN':'INVALID_INPUT',message);}
export function text(value:unknown,label:string,max=200):string {requireValue(typeof value==='string'&&value.trim().length>0&&value.length<=max,`${label}不能为空且不能超过 ${max} 字符`);return value.trim();}
export function number(value:unknown,label:string,min:number,max:number):number {requireValue(typeof value==='number'&&Number.isInteger(value)&&value>=min&&value<=max,`${label}须为 ${min}–${max} 的整数`);return value;}
