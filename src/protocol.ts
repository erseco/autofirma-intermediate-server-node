/**
 * Códigos de error del protocolo `v=1_0` de AutoScript.
 *
 * AutoScript solo entiende estas cadenas: un fallo interno tiene que salir con
 * uno de estos códigos y no como un error HTTP, o quien firma se queda
 * esperando sin explicación. Textos idénticos a los del servidor PHP.
 */
const MESSAGES = {
  "ERR-00": "No se ha indicado código de operación",
  "ERR-01": "Código de operación no soportado",
  "ERR-02": "No se han proporcionado los datos de la operación",
  "ERR-05": "No se ha proporcionado un identificador para los datos",
  "ERR-06": "El identificador para los datos es inválido",
  "ERR-07": "Los datos solicitados o enviados son inválidos",
  "ERR-18": "No se ha podido enviar la firma generada a la Web de origen",
  "ERR-20": "No se ha indicado la versión de la sintaxis de la operación",
} as const;

export type ProtocolErrorCode = keyof typeof MESSAGES;

export function protocolError(code: ProtocolErrorCode): string {
  return `${code}:=${MESSAGES[code]}`;
}

export const ProtocolError = {
  missingOperation: protocolError("ERR-00"),
  unsupportedOperation: protocolError("ERR-01"),
  missingData: protocolError("ERR-02"),
  missingIdentifier: protocolError("ERR-05"),
  invalidIdentifier: protocolError("ERR-06"),
  invalidData: protocolError("ERR-07"),
  storageFailure: protocolError("ERR-18"),
  missingSyntaxVersion: protocolError("ERR-20"),
} as const;
