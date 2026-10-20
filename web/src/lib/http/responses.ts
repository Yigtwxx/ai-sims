import type { z } from 'zod';

/** JSON error body `{ error: <code>, ...extra }`. Never cached, never carries provider details. */
export function errorResponse(
  error: string,
  status: number,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({ error, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export interface RequestIssue {
  path: string;
  message: string;
}

/** Flattens zod issues into a small, client-safe shape. */
export function toRequestIssues(error: z.ZodError): RequestIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || 'body',
    message: issue.message,
  }));
}

/** 400 body for a request that is not JSON or not shaped as expected. */
export function invalidRequest(issues: RequestIssue[]): Response {
  return errorResponse('invalid_request', 400, { issues });
}

/** Status for a request the client abandoned (nginx convention); nobody is listening anyway. */
export const CLIENT_CLOSED_REQUEST = 499;
