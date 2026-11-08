import {setTimeout as delay} from 'node:timers/promises';

function transientConnection(error:unknown):boolean{
  if(!error||typeof error!=='object')return false;
  const {code,message,cause}=error as {code?:string;message?:string;cause?:unknown};
  // Authentication, certificate and schema failures require correction, not retries.
  if(code)return ['ECONNREFUSED','ECONNRESET','ETIMEDOUT','EAI_AGAIN','08000','08001','08003','08006','57P01','57P02','57P03','53300'].includes(code);
  return /Connection terminated (?:unexpectedly|due to connection timeout)|timeout exceeded when trying to connect/i.test(message??'')||!!cause&&cause!==error&&transientConnection(cause);
}

/** Retry only idempotent startup recovery. No listener is opened until it succeeds. */
export async function retryDatabaseStartup<T>(recover:()=>Promise<T>,wait:(ms:number)=>Promise<unknown>=delay):Promise<T>{
  for(let attempt=1;;attempt++){
    try{return await recover();}
    catch(error){
      if(attempt>=3||!transientConnection(error))throw error;
      console.warn(`PostgreSQL startup connection unavailable; retry ${attempt}/2.`);
      await wait(attempt*1000);
    }
  }
}
