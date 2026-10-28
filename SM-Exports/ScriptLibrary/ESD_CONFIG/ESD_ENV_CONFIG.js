// SIT
const ADDON_CONFIG = {
  SIT: {
    AUTHENTICATION: "https://ongoing-engraver-exodus.ngrok-free.dev",
    USER_ADDON: "csep.admin.01",
    DOMAIN_URL: "10.0.62.26",
    IFRAME_ADDON_URL: "http://10.0.62.26:5010",
    GENDOC_URL: "http://10.0.62.26:3000",
    ESD_ECM_SERVICE: {
      BASE_URL: "https://ongoing-engraver-exodus.ngrok-free.dev",
      USER_ID: "ach",
      AUTHORIZATION: "Basic Y3BtOkFhMTIzNDU2",
    },
  },
};

const CURRENT_ENV = "SIT";
const CURRENT_CONFIG = ADDON_CONFIG[CURRENT_ENV];

function getConfigObj() {
  var configObj = {
    isShowWFtab: false,
  };
  if (CURRENT_ENV == "SIT") {
    configObj = {
      isShowWFtab: true,
    };
  }
  return configObj;
}

function getENV() {
  return CURRENT_ENV;
}

function authentication() {
  return CURRENT_CONFIG.AUTHENTICATION;
}