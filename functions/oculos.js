import { paginaCategoria } from "../server/categoria.js";
export const onRequestGet = ctx => paginaCategoria(ctx, "oculos");
