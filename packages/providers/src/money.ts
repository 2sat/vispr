/** Round a vendor USD decimal upward to integer micro-USD without float multiplication. */
export function usdToMicros(value: number | string): number {
 const match=/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
 if(!match)throw new Error('Invalid vendor cost');
 const digits=BigInt(match[1]!+(match[2]??''));const scale=6+Number(match[3]??0)-(match[2]?.length??0);
 if(!Number.isSafeInteger(scale)||Math.abs(scale)>100)throw new Error('Invalid vendor cost');
 const divisor=scale<0?10n**BigInt(-scale):1n;
 const micros=scale<0?(digits+divisor-1n)/divisor:digits*10n**BigInt(scale);
 if(micros>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Vendor cost out of range');
 return Number(micros);
}
