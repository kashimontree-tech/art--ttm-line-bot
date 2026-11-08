"use strict";
// Approval policy helpers. This module is deliberately not connected to the
// production webhook until the database approval flow has been tested.
const APPROVAL_STATES = Object.freeze({
  PENDING: "pending", APPROVED: "approved", REJECTED: "rejected",
  EXPIRED: "expired", COMPLETED: "completed"
});
function validLineUserId(id) {
  return /^U[0-9a-f]{32}$/i.test(String(id || ""));
}
function isAuthorizedOwner(event, ownerUserId) {
  return Boolean(validLineUserId(ownerUserId) &&
    event && event.source && event.source.userId === ownerUserId &&
    event.type === "message" && event.message && event.message.type === "text");
}
function estimateCost({inputTokens, outputTokens, inputUsdPerMillion,
  outputUsdPerMillion, thbPerUsd}) {
  const values = [inputTokens, outputTokens, inputUsdPerMillion,
    outputUsdPerMillion, thbPerUsd].map(Number);
  if (values.some(x => !Number.isFinite(x) || x < 0)) {
    throw new Error("Invalid token or pricing estimate");
  }
  const [input, output, inputRate, outputRate, fx] = values;
  return {inputTokens: input, outputTokens: output,
    totalTokens: input + output,
    usd: (input * inputRate + output * outputRate) / 1000000,
    thb: ((input * inputRate + output * outputRate) / 1000000) * fx};
}
function requireApproval({usesPaidApi, approvalStatus, approvalOwnerId,
  eventOwnerId, expiresAt}) {
  if (!usesPaidApi) return {allowed: true, reason: "no_paid_api"};
  if (approvalStatus !== APPROVAL_STATES.APPROVED) {
    return {allowed: false, reason: "not_approved"};
  }
  if (!validLineUserId(approvalOwnerId) ||
      approvalOwnerId !== eventOwnerId) {
    return {allowed: false, reason: "owner_mismatch"};
  }
  if (!expiresAt || !Number.isFinite(Date.parse(expiresAt)) ||
      Date.parse(expiresAt) <= Date.now()) {
    return {allowed: false, reason: "approval_expired"};
  }
  return {allowed: true, reason: "owner_approved"};
}
function approvalMessage({requester, task, estimate, requestId}) {
  if (!estimate || !Number.isFinite(estimate.thb)) {
    throw new Error("Missing verified cost estimate");
  }
  return [
    "ขออนุมัติใช้ OpenAI API จากพี่เบนซ์ครับ",
    "ผู้สั่งงาน: " + String(requester || "ไม่ระบุ"),
    "งาน: " + String(task || "ไม่ระบุ"),
    "Input tokens (ประมาณ): " + estimate.inputTokens,
    "Output tokens (ประมาณ): " + estimate.outputTokens,
    "รวม (ประมาณ): " + estimate.totalTokens + " tokens",
    "ค่า API (ประมาณ): " + estimate.thb.toFixed(4) + " บาท",
    "รหัสคำขอ: " + String(requestId || ""),
    "สถานะ: รออนุมัติ — ระบบยังไม่เรียก AI",
    "หมายเหตุ: ต้องใช้ LINE mention object แท็กบัญชีพี่เบนซ์จริง"
  ].join("\n");
}
module.exports = {APPROVAL_STATES, validLineUserId, isAuthorizedOwner,
  estimateCost, requireApproval, approvalMessage};
