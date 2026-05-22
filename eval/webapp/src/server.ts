import { app } from "./app.js";

const PORT = parseInt(process.env.PORT ?? "3456", 10);

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export { server };
