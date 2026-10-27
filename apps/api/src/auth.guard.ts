import {
  Injectable,
  Inject,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { Request } from "express";
import { HealthController } from "./health.controller";
import { WarehouseService } from "./warehouse.service";
import { requestAuth } from "./auth-context";
import { authorizeWarehouse, requireAuth, requireOrigin } from "./auth-policy";
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(WarehouseService) private readonly warehouse: WarehouseService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>(),
      name = context.getHandler().name;
    const auth = requestAuth.getStore();
    if (!auth) throw new ForbiddenException("Отсутствует контекст запроса");
    if (
      context.getClass() === HealthController &&
      ["GET", "HEAD"].includes(request.method) &&
      ["live", "ready"].includes(name)
    )
      return true;
    const write = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    if (write) {
      requireOrigin(auth.origin);
      if (!request.is("application/json"))
        throw new ForbiddenException("Ожидается запрос JSON");
    }
    if (context.getClass().name === "AuthController") {
      if (["setupAuth", "login"].includes(name)) {
        if (request.headers["x-wms-request"] !== "1")
          throw new ForbiddenException("Не подтверждён источник запроса");
        return true;
      }
      if (name === "getAuthSession") return true;
      await this.warehouse.authTransaction(async (tx) => {
        const row = await requireAuth(
          tx,
          write,
          ["logout", "changePassword"].includes(name),
        );
        if (
          !["logout", "changePassword"].includes(name) &&
          row.role !== "manager"
        )
          throw new ForbiddenException("Нужны права руководителя");
      });
      return true;
    }
    const warehouseName = name === "updateEmployeeShift" ? "updateShift" : name;
    const op = `${warehouseName}${request.params.id ? `/${request.params.id}` : ""}`;
    await this.warehouse.authTransaction((tx) =>
      authorizeWarehouse(tx, op, write ? request.body : undefined),
    );
    return true;
  }
}
