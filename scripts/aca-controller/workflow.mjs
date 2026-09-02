import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";
import { admitConnectedV4Envelope } from "./receipt.mjs";

const DIGEST=/^[0-9a-f]{64}$/;
const ordinaryData=(value,ancestors=new Set)=>{
 if(value===null||["string","number","boolean"].includes(typeof value))return true;
 if(typeof value!=="object"||utilTypes.isProxy(value)||ancestors.has(value))return false;
 const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);if(prototype!==(array?Array.prototype:Object.prototype))return false;
 ancestors.add(value);try{
  const descriptors=Object.getOwnPropertyDescriptors(value);let arrayLength=null,indexCount=0;
  for(const key of Reflect.ownKeys(descriptors)){
   if(typeof key!=="string")return false;const descriptor=descriptors[key];if(!Object.hasOwn(descriptor,"value"))return false;
   if(array){if(key==="length"){arrayLength=descriptor.value;if(!Number.isSafeInteger(arrayLength)||arrayLength<0||arrayLength>4294967295)return false;continue}if(!/^(?:0|[1-9]\d*)$/.test(key)){return false}const index=Number(key);if(index>4294967294||String(index)!==key){return false}indexCount+=1}
   if(!descriptor.enumerable||!ordinaryData(descriptor.value,ancestors))return false;
  }
  return !array||(arrayLength!==null&&indexCount===arrayLength);
 }finally{ancestors.delete(value)}
};
const plain=value=>value!==null&&typeof value==="object"&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const exact=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const deepFreeze=value=>{if(value&&typeof value==="object"&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))deepFreeze(child)}return value};
const canonical=value=>Array.isArray(value)?value.map(canonical):plain(value)?Object.fromEntries(Object.keys(value).filter(key=>key!=="handoffDigest").sort().map(key=>[key,canonical(value[key])])):value;
const fail=()=>{throw new Error("EXACT_PR_HANDOFF_REFUSED")};
export const exactPrHandoffDigest=value=>createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

export function createExactPrHandoff(input){
 if(!exact(input,["connected","github"]))fail();
 const connected=structuredClone(input.connected),github=structuredClone(input.github);
 const admission=admitConnectedV4Envelope(connected,github);if(!admission.valid)fail();
 const source=admission.envelope,external=source.external,local=source.local,relation=source.relationships.candidateRelation;
 if(!["PARENT_COMMIT_ONLY","REMOTE_HEAD_DIFFERS"].includes(relation)||!DIGEST.test(source.envelopeDigest))fail();
 const url=`https://github.com/${github.owner}/${github.repository}/pull/${github.pullNumber}`;
 const summary=relation==="PARENT_COMMIT_ONLY"
  ?`PR records cover observed head ${external.pull.head.sha}; they do not cover local dirty snapshot ${local.repository.snapshotDigest}.`
  :`PR head ${external.pull.head.sha} differs from local parent ${local.repository.parentCommit}; neither covers local dirty snapshot ${local.repository.snapshotDigest}.`;
 const value={
  schema:"aca-exact-pr-handoff/v1",
  provider:"GITHUB",
  authority:"NONE",
  effect:"NOT_ATTEMPTED",
  effectCapability:"ABSENT",
  writeAuthorization:"ABSENT",
  sourceEnvelopeDigest:source.envelopeDigest,
  repository:{id:external.repositoryId,nodeId:external.repositoryNodeId,owner:github.owner,name:github.repository},
  pull:{nodeId:external.pull.nodeId,number:github.pullNumber,url,state:external.pull.state,draft:external.pull.draft,headSha:external.pull.head.sha,baseSha:external.pull.base.sha},
  local:{snapshotDigest:local.repository.snapshotDigest,parentCommit:local.repository.parentCommit,baseCommit:local.repository.baseCommit},
  relationship:{candidateRelation:relation,candidateCoverage:"NOT_LOCAL_DIRTY_SNAPSHOT"},
  observation:{startedAt:external.startedAt,finishedAt:external.finishedAt,availability:external.availability,lifecycle:external.lifecycle,outcome:external.outcome,passed:external.aggregate.passed,failed:external.aggregate.failed,pending:external.aggregate.pending,total:external.aggregate.total},
  routing:{decision:source.routing.decision,reason:source.routing.reason},
  writebackEligibility:"BLOCKED_LOCAL_SNAPSHOT_NOT_REMOTE",
  title:`Exact PR handoff · ${github.owner}/${github.repository}#${github.pullNumber}`,
  summary,
  warning:"Point-in-time observation; not monitored. The PR may have moved since observation. Reobserve before relying on its current head.",
 };
 return deepFreeze({...value,handoffDigest:exactPrHandoffDigest(value)});
}

export function admitExactPrHandoff(input,expected){
 try{
  if(!ordinaryData(input)||!ordinaryData(expected)||!plain(input)||!exact(expected,["connected","github"]))fail();
  const rebuilt=createExactPrHandoff(expected);
  if(!DIGEST.test(input.handoffDigest)||input.handoffDigest!==exactPrHandoffDigest(input)||JSON.stringify(input)!==JSON.stringify(rebuilt))fail();
  return deepFreeze({valid:true,handoff:rebuilt,authority:"NONE"});
 }catch{return deepFreeze({valid:false,code:"INVALID_EXACT_PR_HANDOFF",authority:"NONE"})}
}
