const { authenticate } = require("../auth/authenticate");
const disconnectConversation = require("./disconnectConversation");

function chunkArray(array, size) {
  return Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
    array.slice(i * size, i * size + size)
  );
}

// Função para processar um bloco de conversas (desconectar em lotes de até 300/min)
async function processChunk(chunk, clientId, clientSecret, orgRegion) {
  // gera novo token para cada bloco
  const token = await authenticate(clientId, clientSecret, orgRegion);

  // processa desconexão em lotes de 300
  for (let i = 0; i < chunk.length; i += 300) {
    const batch = chunk.slice(i, i + 300);
    await Promise.all(batch.map(conversation => disconnectConversation(conversation)));
    if (i + 300 < chunk.length) {
      // espera 1 min entre os lotes de 300
      await new Promise(resolve => setTimeout(resolve, 30 * 1000));
    }
  }
}


module.exports = {
  chunkArray,
  processChunk
};