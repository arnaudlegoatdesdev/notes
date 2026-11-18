// Bound concurrent reads, writes and memory usage during a batch of attachments.
const BATCH_SIZE = 3;

export async function transferAttachments<T>(items: T[], transfer: (item: T) => Promise<void>) {
  for (let offset = 0; offset < items.length; offset += BATCH_SIZE) {
    const results = await Promise.allSettled(items.slice(offset, offset + BATCH_SIZE).map(transfer));
    const failure = results.find(result => result.status === "rejected");
    if (failure) throw failure.reason;
  }
}
