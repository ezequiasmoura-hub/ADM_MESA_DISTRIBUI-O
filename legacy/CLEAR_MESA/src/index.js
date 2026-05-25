const { authenticate } = require("../auth/authenticate");
// const disconnectConversation = require("../functions/disconnectConversation");
const getConversations = require("../functions/getMesaConversations");
const { chunkArray, processChunk } = require("../functions/promisseDisconnect");

require("dotenv").config();

const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const orgRegion = process.env.ORG_REGION;

async function main() {
  try {
    await authenticate(clientId, clientSecret, orgRegion)
    const conversations = await getConversations();
    const conversationChunks = chunkArray(conversations, 300); // blocos de 300

    // Processa cada bloco em sequência, gerando token para cada um
    for (const chunk of conversationChunks) {
      await processChunk(chunk, clientId, clientSecret, orgRegion);
    }

    console.log("Todas as conversas foram desconectadas!");
  } catch (error) {
    console.log(`Erro ao executar main script: \n ${error}`);
  }
}

main();
