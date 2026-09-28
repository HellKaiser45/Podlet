import Elysia from "elysia";
import { AppContainer } from "../runtime";

export const skillsRoutes = (container: AppContainer) =>
  new Elysia({ prefix: "/skills" }).get("/all", () => {
    return Object.values(container.skillManager.availableSkills);
  });
