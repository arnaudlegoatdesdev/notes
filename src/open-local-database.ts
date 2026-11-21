export function openLocalDatabase(
  name: string,
  version: number,
  initialize: (database: IDBDatabase) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Le stockage local sécurisé est indisponible dans ce navigateur."));
      return;
    }

    const request = indexedDB.open(name, version);
    let abandoned = false;
    const fail = (error: Error) => {
      abandoned = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error("Le navigateur ne répond pas pour le stockage local. Réessayez.")), 12_000);
    request.onblocked = () => fail(new Error("Un autre onglet Notes bloque le stockage local. Fermez-le puis réessayez."));
    request.onerror = () => fail(request.error ?? new Error("Impossible d’ouvrir le stockage local."));
    request.onupgradeneeded = () => {
      if (abandoned) request.transaction?.abort();
      else initialize(request.result);
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      const database = request.result;
      if (abandoned) {
        database.close();
        return;
      }
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}
