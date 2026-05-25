const platformClient = require("purecloud-platform-client-v2");

async function authenticate(clientId, clientSecret, orgRegion) {
  const environment = platformClient.PureCloudRegionHosts[orgRegion];
  const client = platformClient.ApiClient.instance;
  client.setEnvironment(environment);

  try {
    return await client.loginClientCredentialsGrant(clientId, clientSecret);
  } catch (e) {
    console.error(`Authentication error has occurred.`, e);
    process.exit(1);
  }
}

exports.authenticate = authenticate;
