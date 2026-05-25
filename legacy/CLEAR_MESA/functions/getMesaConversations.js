const platformClient = require("purecloud-platform-client-v2");
const conversationsApi = new platformClient.ConversationsApi();

async function getConversations() {
  //   let pageNumber = 1;
  //   let pageCount = 1;
  let conversationsList = [];

  let body = {
    order: "asc",
    filter: {
      type: "or",
      predicates: [
    
        // {
        //   dimension: "queueId", //Mesa Distribuição - Backoffice Varejo AL
        //   value: "16670797-0795-4ddb-b93d-b307e8efa5fa",
        // },
        // {
        //   dimension: "queueId", //"Mesa Distribuição – Backoffice Varejo MA"
        //   value: "6e005f7c-56a9-4bbf-8c3e-7d2dcd5ffbc3",
        // },
        // {
        //   dimension: "queueId", //"Mesa Distribuição – Backoffice Varejo PA"
        //   value: "6fd1d9e1-241b-4e27-94f7-c20e736c65d0",
        // },
        // {
        //   dimension: "queueId", //"Mesa Distribuição – Backoffice Varejo PI"
        //   value: "291d0f7e-8d2d-4b0c-a126-fbfaefc7c677",
        // },
        // {
        //   dimension: "queueId", //Mesa Distribuição – Backoffice Varejo CEA
        //   value: "9708283f-1ced-45de-9639-60fbcf6fbb24",
        // },
        {
          dimension: "queueId", //Mesa Distribuição - Backoffice Varejo CEEE
          value: "122915bd-9047-4730-890a-908a42cfd5f1",
        },
	      // {
        //   dimension: "queueId", //Mesa Distribuição - Backoffice Varejo CSA
        //   value: "e9bf42cd-e23f-4d70-ac0d-2ad60602ba9f",
        // },
        // {
        //   dimension: "queueId", //Mesa Distribuição - Backoffice Varejo GO
        //   value: "4f25f041-e80d-4554-9a79-a358ad85d686",
        // },
    

      ],
    },
    metrics: [
      {
        metric: "oWaiting",
      },
    ],
    groupBy: ["conversationId"],
  };

  try {
    const conversations =
      await conversationsApi.postAnalyticsConversationsActivityQuery(body);
    console.log(conversations,null,2)
    conversations.results.map((conversations) => {
      conversationsList.push(conversations.group.conversationId);
    });
    return conversationsList;

   
  } catch (error) {
    console.log(error)
    console.log(`There was failure to get conversations`);
  }
}

module.exports = getConversations;
