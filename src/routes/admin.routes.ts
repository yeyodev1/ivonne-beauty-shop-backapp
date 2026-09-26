import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { adminMiddleware } from "../middlewares/admin.middleware";
import { uploadMiddleware } from "../middlewares/upload.middleware";
import * as adminController from "../controllers/admin.controller";
import * as categoryController from "../controllers/category.controller";
import * as orderController from "../controllers/order.controller";
import * as productController from "../controllers/product.controller";
import * as settingsController from "../controllers/settings.controller";

const router = Router();

router.use(authMiddleware, adminMiddleware);

router.get("/stats", adminController.stats);
router.get("/customers", adminController.customers);

router.get("/products", productController.listAdmin);
router.post("/products", productController.create);
router.get("/products/:id", productController.getAdminById);
router.put("/products/:id", productController.update);
router.delete("/products/:id", productController.remove);
router.post(
  "/products/:id/images",
  uploadMiddleware.array("images", 8),
  productController.addImages,
);
router.delete("/products/:id/images", productController.removeImage);
router.put("/products/:id/images/order", productController.reorderImages);

router.get("/categories", categoryController.listAdmin);
router.post("/categories", categoryController.create);
router.put("/categories/:id", categoryController.update);
router.delete("/categories/:id", categoryController.remove);
router.post("/categories/:id/image", uploadMiddleware.single("image"), categoryController.setImage);

router.get("/orders", orderController.listAdmin);
router.get("/orders/:id", orderController.getAdminById);
router.patch("/orders/:id/status", orderController.updateStatus);

router.get("/settings", settingsController.getAdmin);
router.put("/settings", settingsController.update);

export default router;
