import initPinecone from "./initPinecone.service";

async function upsertVector(id: string, values: number[], metadata: any) {
  const index = await initPinecone();

  await index.upsert([
    {
      id,
      values,
      metadata,
    },
  ]);

  console.log("Vector inserted!");
}

export default upsertVector;