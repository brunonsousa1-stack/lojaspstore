import { json, configPublica } from "../../server/loja.js";
export const onRequestGet = ({ env }) => json(configPublica(env));
