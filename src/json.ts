import { concatBytes, readU16, readU32, writeU16 } from "./binary";
import { DnsFormatError, parseDnsMessage, parseName } from "./dns";

const DNS_HEADER_LENGTH = 12;
const MAX_JSON_NAME_LENGTH = 253;

interface JsonAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

interface JsonDnsResponse {
  Status: number;
  TC: boolean;
  RD: boolean;
  RA: boolean;
  AD: boolean;
  CD: boolean;
  Question: Array<{ name: string; type: number }>;
  Answer?: JsonAnswer[];
}

const TYPE_BY_NAME = new Map<string, number>([
  ["a", 1],
  ["ns", 2],
  ["cname", 5],
  ["soa", 6],
  ["ptr", 12],
  ["mx", 15],
  ["txt", 16],
  ["aaaa", 28],
  ["srv", 33],
  ["caa", 257]
]);

function jsonHeaders(): Headers {
  const headers = new Headers();
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

function jsonResponse(payload: JsonDnsResponse, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: jsonHeaders() });
}

function encodeDnsName(value: string): Uint8Array {
  const normalized = value.toLowerCase().replace(/\.$/, "");
  if (normalized.length === 0 || normalized.length > MAX_JSON_NAME_LENGTH) {
    throw new DnsFormatError("invalid_json_name");
  }

  const labels = normalized.split(".");
  const parts: Uint8Array[] = [];
  let encodedLength = 1;
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) {
      throw new DnsFormatError("invalid_json_name_label");
    }
    for (const char of label) {
      const code = char.charCodeAt(0);
      const allowed =
        (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57) ||
        code === 45 ||
        code === 95;
      if (!allowed) throw new DnsFormatError("invalid_json_name_character");
    }
    const bytes = new TextEncoder().encode(label);
    const part = new Uint8Array(bytes.length + 1);
    part[0] = bytes.length;
    part.set(bytes, 1);
    parts.push(part);
    encodedLength += bytes.length + 1;
  }
  if (encodedLength > 255) throw new DnsFormatError("json_name_too_long");
  return concatBytes([...parts, new Uint8Array(1)]);
}

function parseType(value: string | null): number {
  if (value === null) return 1;
  if (value.length === 0 || value.length > 16) {
    throw new DnsFormatError("invalid_json_type");
  }
  if (/^[0-9]+$/.test(value)) {
    const numeric = Number(value);
    if (Number.isSafeInteger(numeric) && numeric >= 1 && numeric <= 0xffff) {
      return numeric;
    }
  }
  const type = TYPE_BY_NAME.get(value.trim().toLowerCase());
  if (type === undefined) throw new DnsFormatError("invalid_json_type");
  return type;
}

function createJsonDnsQuery(
  name: string,
  type: number,
  id = 0x1234
): Uint8Array {
  const qname = encodeDnsName(name);
  const output = new Uint8Array(DNS_HEADER_LENGTH + qname.length + 4);
  writeU16(output, 0, id);
  writeU16(output, 2, 0x0100); // RD
  writeU16(output, 4, 1);
  output.set(qname, DNS_HEADER_LENGTH);
  const typeOffset = DNS_HEADER_LENGTH + qname.length;
  writeU16(output, typeOffset, type);
  writeU16(output, typeOffset + 2, 1);
  return output;
}

export function parseJsonRequest(url: URL, id = 0x1234): Uint8Array {
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => key !== "name" && key !== "type")) {
    throw new DnsFormatError("invalid_json_parameters");
  }
  if (url.searchParams.getAll("name").length !== 1) {
    throw new DnsFormatError("invalid_json_name");
  }
  const typeValues = url.searchParams.getAll("type");
  if (typeValues.length > 1) {
    throw new DnsFormatError("invalid_json_type");
  }

  const name = url.searchParams.get("name");
  if (name === null || name.length > 255) {
    throw new DnsFormatError("invalid_json_name");
  }
  const type = parseType(url.searchParams.get("type"));
  return createJsonDnsQuery(name, type, id);
}

function dnsNameString(labels: readonly Uint8Array[]): string {
  const decoder = new TextDecoder();
  return labels.map((label) => decoder.decode(label)).join(".") + ".";
}

function ipv4String(bytes: Uint8Array): string {
  return `${bytes[0] ?? 0}.${bytes[1] ?? 0}.${bytes[2] ?? 0}.${bytes[3] ?? 0}`;
}

function ipv6String(bytes: Uint8Array): string {
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) {
    groups.push(((bytes[i] ?? 0) << 8 | (bytes[i + 1] ?? 0)).toString(16));
  }

  let bestStart = -1;
  let bestLength = 0;
  let currentStart = -1;
  let currentLength = 0;
  for (let i = 0; i < groups.length; i += 1) {
    if (groups[i] === "0") {
      if (currentStart < 0) currentStart = i;
      currentLength += 1;
      if (currentLength > bestLength) {
        bestStart = currentStart;
        bestLength = currentLength;
      }
    } else {
      currentStart = -1;
      currentLength = 0;
    }
  }
  if (bestLength < 2) return groups.join(":");
  return [
    ...groups.slice(0, bestStart),
    "",
    ...groups.slice(bestStart + bestLength)
  ].join(":");
}

function txtString(rdata: Uint8Array): string {
  let result = "";
  let offset = 0;
  while (offset < rdata.length) {
    const size = rdata[offset] ?? 0;
    offset += 1;
    if (offset + size > rdata.length) throw new DnsFormatError("truncated_txt_string");
    result += new TextDecoder().decode(rdata.slice(offset, offset + size));
    offset += size;
  }
  return result;
}

function recordData(data: Uint8Array, record: ResourceRecordJson): string {
  const rdata = data.slice(record.rdataStart, record.rdataEnd);
  switch (record.type) {
    case 1:
      if (rdata.length !== 4) throw new DnsFormatError("invalid_a_rdata");
      return ipv4String(rdata);
    case 28:
      if (rdata.length !== 16) throw new DnsFormatError("invalid_aaaa_rdata");
      return ipv6String(rdata);
    case 2:
    case 5:
    case 12: {
      const name = parseName(data, record.rdataStart);
      if (name.nextOffset !== record.rdataEnd) {
        throw new DnsFormatError("invalid_name_rdata");
      }
      return dnsNameString(name.labels);
    }
    case 6: {
      const mname = parseName(data, record.rdataStart);
      const rname = parseName(data, mname.nextOffset);
      if (rname.nextOffset + 20 !== record.rdataEnd) {
        throw new DnsFormatError("invalid_soa_rdata");
      }
      const numbers: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        numbers.push(readU32(data, rname.nextOffset + i * 4));
      }
      return `${dnsNameString(mname.labels)} ${dnsNameString(rname.labels)} ${numbers.join(" ")}`;
    }
    case 15: {
      if (record.rdataStart + 2 > record.rdataEnd) {
        throw new DnsFormatError("invalid_mx_rdata");
      }
      const exchange = parseName(data, record.rdataStart + 2);
      if (exchange.nextOffset !== record.rdataEnd) {
        throw new DnsFormatError("invalid_mx_rdata");
      }
      return `${readU16(data, record.rdataStart)} ${dnsNameString(exchange.labels)}`;
    }
    case 16:
      return txtString(rdata);
    default:
      return [...rdata].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
}

interface ResourceRecordJson {
  type: number;
  ttl: number;
  rdataStart: number;
  rdataEnd: number;
  ownerLabels: Uint8Array[];
}

function parseAnswerRecords(data: Uint8Array): {
  answers: JsonAnswer[];
  questionName: string;
  questionType: number;
} {
  const info = parseDnsMessage(data);
  let offset = info.question.endOffset;
  const answers: JsonAnswer[] = [];

  for (let i = 0; i < info.answerCount; i += 1) {
    const owner = parseName(data, offset);
    if (owner.nextOffset + 10 > data.length) {
      throw new DnsFormatError("truncated_record_header");
    }
    const type = readU16(data, owner.nextOffset);
    const ttl = readU32(data, owner.nextOffset + 4);
    const rdLength = readU16(data, owner.nextOffset + 8);
    const rdataStart = owner.nextOffset + 10;
    const rdataEnd = rdataStart + rdLength;
    if (rdataEnd > data.length) throw new DnsFormatError("truncated_rdata");
    const record: ResourceRecordJson = {
      type,
      ttl,
      rdataStart,
      rdataEnd,
      ownerLabels: owner.labels
    };
    answers.push({
      name: dnsNameString(record.ownerLabels),
      type,
      TTL: ttl,
      data: recordData(data, record)
    });
    offset = rdataEnd;
  }

  return {
    answers,
    questionName: dnsNameString(info.question.name.labels),
    questionType: info.question.type
  };
}

export function jsonDnsResponse(data: Uint8Array): Response {
  const info = parseDnsMessage(data);
  const { answers, questionName, questionType } = parseAnswerRecords(data);
  const flags = info.flags;
  const payload: JsonDnsResponse = {
    Status: flags & 0x000f,
    TC: (flags & 0x0200) !== 0,
    RD: (flags & 0x0100) !== 0,
    RA: (flags & 0x0080) !== 0,
    AD: (flags & 0x0020) !== 0,
    CD: (flags & 0x0010) !== 0,
    Question: [{ name: questionName, type: questionType }],
    Answer: answers
  };
  return jsonResponse(payload);
}

export function jsonServfailResponse(name: string, type: number): Response {
  const normalizedName = name.toLowerCase();
  const fqdn = normalizedName.endsWith(".") ? normalizedName : `${normalizedName}.`;
  return jsonResponse({
    Status: 2,
    TC: false,
    RD: true,
    RA: false,
    AD: false,
    CD: false,
    Question: [{ name: fqdn, type }]
  });
}

export function jsonBadRequestResponse(): Response {
  return new Response(JSON.stringify({ error: "bad_request" }), {
    status: 400,
    headers: jsonHeaders()
  });
}

