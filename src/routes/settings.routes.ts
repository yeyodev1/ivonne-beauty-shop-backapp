import { Router } from "express";
import * as settingsController from "../controllers/settings.controller";

const router = Router();

router.get("/", settingsController.getPublic);

export default router;
