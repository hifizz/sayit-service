export class ServiceError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); this.name = 'ServiceError'; }
}
export function upstreamError(status?: number): ServiceError {
  return new ServiceError(status === 429 || (status !== undefined && status >= 500) ? 503 : 502, 'provider_unavailable');
}
