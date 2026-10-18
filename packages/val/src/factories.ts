// Factory functions — the public schema/action constructors. One
// allocation per call, no hidden objects.

import { VSchema } from "./types.ts";
import {
  VAny,
  VArray,
  VBool,
  VCustom,
  VLiteral,
  VNullable,
  VNullish,
  VNum,
  VObject,
  VOptional,
  VPicklist,
  VPipe,
  VRecord,
  VStr,
  VTuple,
  VUnion,
  VNever,
} from "./schemas.ts";
import {
  VCheckAction,
  VLengthAction,
  VNumCheck,
  VNumClamp,
  VStrCheck,
  VStrTransform,
  VTransformAction,
} from "./actions.ts";

// ---------------------------------------------------------------- factories

export function string(): VStr {
  return new VStr();
}
export function number(): VNum {
  return new VNum();
}
export function boolean(): VBool {
  return new VBool();
}
export function any(): VSchema {
  return new VAny();
}
export function unknown(): VSchema {
  return new VAny();
}
export function never(): VSchema {
  return new VNever();
}
export function literal(req: string | number | boolean | null): VSchema {
  return new VLiteral(req);
}
export function picklist(options: string[]): VSchema {
  return new VPicklist(options);
}
export function nullable(inner: VSchema): VSchema {
  return new VNullable(inner);
}
export function optional(inner: VSchema): VSchema {
  return new VOptional(inner, 0, 3, "", 0, false);
}
export function optionalStr(inner: VSchema, def: string): VSchema {
  return new VOptional(inner, 1, 0, def, 0, false);
}
export function optionalNum(inner: VSchema, def: number): VSchema {
  return new VOptional(inner, 1, 1, "", def, false);
}
export function optionalBool(inner: VSchema, def: boolean): VSchema {
  return new VOptional(inner, 1, 2, "", 0, def);
}
export function nullish(inner: VSchema): VSchema {
  return new VNullish(inner);
}
export function array(item: VSchema): VArray {
  return new VArray(item);
}
export function tuple(items: VSchema[]): VTuple {
  return new VTuple(items);
}
export function object(entries: { [k: string]: VSchema }): VObject {
  return new VObject(entries, 0);
}
export function looseObject(entries: { [k: string]: VSchema }): VObject {
  return new VObject(entries, 1);
}
export function strictObject(entries: { [k: string]: VSchema }): VObject {
  return new VObject(entries, 2);
}
export function record(keySch: VSchema, valSch: VSchema): VRecord {
  return new VRecord(keySch, valSch);
}
export function union(options: VSchema[]): VSchema {
  return new VUnion(options);
}
export function custom(fn: (v: unknown) => boolean, expects?: string): VSchema {
  return new VCustom(fn, expects === undefined ? "custom" : expects);
}

export function pipe(inner: VSchema, ...acts: VSchema[]): VSchema {
  return new VPipe(inner, acts);
}

// length actions (string | array length)
export function minLength(n: number, msg?: string): VSchema {
  return new VLengthAction("min_length", 0, n, msg === undefined ? null : msg);
}
export function maxLength(n: number, msg?: string): VSchema {
  return new VLengthAction("max_length", 1, n, msg === undefined ? null : msg);
}
export function length(n: number, msg?: string): VSchema {
  return new VLengthAction("length", 2, n, msg === undefined ? null : msg);
}
export function nonEmpty(msg?: string): VSchema {
  return new VLengthAction("non_empty", 0, 1, msg === undefined ? null : msg);
}
export function empty(msg?: string): VSchema {
  return new VStrCheck("empty", null, "", "empty", msg === undefined ? null : msg);
}

// string checks
export function regex(re: RegExp, msg?: string): VSchema {
  return new VStrCheck("regex", re, "", String(re), msg === undefined ? null : msg);
}
const EMAIL_RE = /^[\w+-]+(?:\.[\w+-]+)*@[\da-zA-Z]+(?:[.-][\da-zA-Z]+)*\.[a-zA-Z]{2,}$/;
export function email(msg?: string): VSchema {
  return new VStrCheck("email", EMAIL_RE, "", "email", msg === undefined ? null : msg);
}
const UUID_RE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;
export function uuid(msg?: string): VSchema {
  return new VStrCheck("uuid", UUID_RE, "", "uuid", msg === undefined ? null : msg);
}
const URL_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\/\S+$/u;
export function url(msg?: string): VSchema {
  return new VStrCheck("url", URL_RE, "", "url", msg === undefined ? null : msg);
}
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/u;
export function ipv4(msg?: string): VSchema {
  return new VStrCheck("ipv4", IPV4_RE, "", "ipv4", msg === undefined ? null : msg);
}
const DIGITS_RE = /^\d+$/u;
export function digits(msg?: string): VSchema {
  return new VStrCheck("digits", DIGITS_RE, "", "digits", msg === undefined ? null : msg);
}
export function startsWith(s: string, msg?: string): VSchema {
  return new VStrCheck("starts_with", null, s, s, msg === undefined ? null : msg);
}
export function endsWith(s: string, msg?: string): VSchema {
  return new VStrCheck("ends_with", null, s, s, msg === undefined ? null : msg);
}
export function includes(s: string, msg?: string): VSchema {
  return new VStrCheck("includes", null, s, s, msg === undefined ? null : msg);
}

// number checks (expects strings built directly — safe under scriptc;
// valibot's own minValue/maxValue hit SC2020 Date-fences at construction)
export function integer(msg?: string): VSchema {
  return new VNumCheck("integer", 0, "integer", msg === undefined ? null : msg);
}
export function finite(msg?: string): VSchema {
  return new VNumCheck("finite", 0, "finite", msg === undefined ? null : msg);
}
export function safeInteger(msg?: string): VSchema {
  return new VNumCheck("safe_integer", 0, "safe integer", msg === undefined ? null : msg);
}
export function minValue(n: number, msg?: string): VSchema {
  return new VNumCheck("min_value", n, ">=" + n, msg === undefined ? null : msg);
}
export function maxValue(n: number, msg?: string): VSchema {
  return new VNumCheck("max_value", n, "<=" + n, msg === undefined ? null : msg);
}
export function gtValue(n: number, msg?: string): VSchema {
  return new VNumCheck("gt_value", n, ">" + n, msg === undefined ? null : msg);
}
export function ltValue(n: number, msg?: string): VSchema {
  return new VNumCheck("lt_value", n, "<" + n, msg === undefined ? null : msg);
}
export function multipleOf(n: number, msg?: string): VSchema {
  return new VNumCheck("multiple_of", n, "%" + n, msg === undefined ? null : msg);
}

// custom + transform
export function check(fn: (v: unknown) => boolean, msg?: string): VSchema {
  return new VCheckAction(fn, "check", msg === undefined ? null : msg);
}
export function transform(fn: (v: unknown) => unknown): VSchema {
  return new VTransformAction(fn);
}
export function trim(): VSchema {
  return new VStrTransform("trim");
}
export function trimStart(): VSchema {
  return new VStrTransform("trim_start");
}
export function trimEnd(): VSchema {
  return new VStrTransform("trim_end");
}
export function toLowerCase(): VSchema {
  return new VStrTransform("to_lower_case");
}
export function toUpperCase(): VSchema {
  return new VStrTransform("to_upper_case");
}
export function toMinValue(n: number): VSchema {
  return new VNumClamp("to_min_value", n);
}
export function toMaxValue(n: number): VSchema {
  return new VNumClamp("to_max_value", n);
}
