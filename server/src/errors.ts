export class ApiError extends Error {
  readonly statusCode: number
  readonly code: string

  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
  }
}

export const invalidRequest = (message: string) => new ApiError(400, 'invalid_request', message)
export const unauthorized = (message = 'unauthorized') => new ApiError(401, 'unauthorized', message)
export const forbidden = (message = 'forbidden') => new ApiError(403, 'forbidden', message)
export const notFound = (message = 'not found') => new ApiError(404, 'not_found', message)
export const conflict = (code: string, message: string) => new ApiError(409, code, message)
export const payloadTooLarge = (message = 'payload too large') => new ApiError(413, 'payload_too_large', message)
