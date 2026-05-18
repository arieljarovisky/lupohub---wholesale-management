/** Ejecuta una promesa con tope de tiempo; evita que el proxy (Railway) corte con 502 sin CORS. */
export function withRequestTimeout<T>(
  ms: number,
  fn: () => Promise<T>,
  timeoutMessage: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(timeoutMessage) as Error & { status?: number; code?: string };
      err.status = 504;
      err.code = 'REQUEST_TIMEOUT';
      reject(err);
    }, ms);
    fn()
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
