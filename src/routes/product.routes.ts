import { Router } from "express";
import * as productController from "../controllers/product.controller";

const router = Router();

router.get("/", productController.listPublic);
// Antes de "/:slug" para que "brands" no se lea como un slug.
router.get("/brands", productController.listBrands);
router.get("/:slug", productController.getBySlug);

export default router;
