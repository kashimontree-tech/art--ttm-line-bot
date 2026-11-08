"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const p = require("./api-approval-policy");
const owner = "U" + "a".repeat(32);
const other = "U" + "b".repeat(32);
test("no paid API is allowed", () => {
  assert.equal(p.requireApproval({usesPaidApi:false}).allowed,true);
});
test("paid API fails closed without approval", () => {
  for(const state of [undefined,"pending","rejected","expired","completed"]){
    assert.equal(p.requireApproval({usesPaidApi:true,approvalStatus:state}).allowed,false);
  }
});
test("only exact verified owner can approve", () => {
  assert.equal(p.isAuthorizedOwner({type:"message",source:{userId:other},message:{type:"text"}},owner),false);
  assert.equal(p.isAuthorizedOwner({type:"message",source:{userId:owner},message:{type:"text"}},owner),true);
  assert.equal(p.requireApproval({usesPaidApi:true,approvalStatus:"approved",
    approvalOwnerId:owner,eventOwnerId:other,
    expiresAt:new Date(Date.now()+60000).toISOString()}).allowed,false);
});
test("expired approval cannot authorize paid work", () => {
  assert.equal(p.requireApproval({usesPaidApi:true,approvalStatus:"approved",
    approvalOwnerId:owner,eventOwnerId:owner,
    expiresAt:new Date(Date.now()-60000).toISOString()}).allowed,false);
});
test("approved unexpired request permits work", () => {
  assert.equal(p.requireApproval({usesPaidApi:true,approvalStatus:"approved",
    approvalOwnerId:owner,eventOwnerId:owner,
    expiresAt:new Date(Date.now()+60000).toISOString()}).allowed,true);
});
test("estimate uses both input and output pricing", () => {
  const e=p.estimateCost({inputTokens:1000000,outputTokens:1000000,
    inputUsdPerMillion:1,outputUsdPerMillion:2,thbPerUsd:35});
  assert.equal(e.totalTokens,2000000);assert.equal(e.usd,3);assert.equal(e.thb,105);
});
test("invalid estimates are rejected", () => {
  assert.throws(()=>p.estimateCost({inputTokens:-1,outputTokens:5,
    inputUsdPerMillion:1,outputUsdPerMillion:1,thbPerUsd:35}));
});
