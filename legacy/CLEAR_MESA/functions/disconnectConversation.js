const platformClient = require("purecloud-platform-client-v2");
const conversationsApi = new platformClient.ConversationsApi();

async function disconnectConversation(
  conversationId,
  retries = 5,
  delay = 32000
) {
  for (let i = 0; i < retries; i++) {
    try {
      await conversationsApi.postConversationDisconnect(conversationId);
      console.log(`Interação com id: ${conversationId} foi desconectada.`);
      return;
    } catch (error) {
      if (error.response && error.response.status === 429) {
        const retryAfter =
          error.response.headers["retry-after"] || delay / 1000;
        console.warn(
          `Rate limit atingido. Tentando novamente em ${retryAfter} segundos...`
        );
        await new Promise((res) => setTimeout(res, retryAfter * 1000));
      } else {
        console.error(
          `Falha ao desconectar conversa ${conversationId}. Tentativa ${
            i + 1
          } de ${retries}`
        );
        console.error(error);
        await new Promise((res) => setTimeout(res, delay));
      }
    }
  }

  console.error(
    `Falha ao desconectar conversa ${conversationId} após ${retries} tentativas.`
  );
}

module.exports = disconnectConversation;
