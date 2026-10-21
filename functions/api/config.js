import { json, configPublica } from "../../server/loja.js";
export const onRequestGet = async ({ env, request }) => json(await configPublica(env, request));
