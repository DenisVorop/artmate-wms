import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Req,
  Res,
  HttpCode,
  Inject,
  ValidationPipe,
} from "@nestjs/common";
import {
  ApiTags,
  ApiCookieAuth,
  ApiOperation,
  ApiOkResponse,
  ApiBody,
  ApiParam,
} from "@nestjs/swagger";
import { Request, Response } from "express";
import * as D from "./dto";
import { AuthService, AuthResult } from "./auth.service";
export const cookieName = () =>
  process.env.WMS_AUTH_COOKIE_NAME ?? "wms_session";
function cookie(response: Response, token: string | null) {
  const secure =
    process.env.WMS_AUTH_COOKIE_SECURE === "true" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${cookieName()}=${token ?? ""}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? 43200 : 0}${secure}`,
  );
}
const pipe = (type: new () => unknown) =>
  new ValidationPipe({
    expectedType: type,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
@ApiTags("auth")
@Controller("api/auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  private _session(result: AuthResult, response: Response) {
    cookie(response, result.token);
    return result.session;
  }
  private async _accounts(
    result: Promise<D.AuthAccountsDto>,
    response: Response,
  ) {
    const accounts = await result;
    if (!(await this.auth.getAuthSession()).user) cookie(response, null);
    return accounts;
  }
  @Get("session")
  @ApiOperation({ operationId: "getAuthSession" })
  @ApiOkResponse({ type: D.AuthSessionDto })
  getAuthSession() {
    return this.auth.getAuthSession();
  }
  @Post("setup")
  @HttpCode(200)
  @ApiOperation({ operationId: "setupAuth" })
  @ApiBody({ type: D.SetupAuthDto })
  @ApiOkResponse({ type: D.AuthSessionDto })
  async setupAuth(
    @Body(pipe(D.SetupAuthDto)) body: D.SetupAuthDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this._session(
      await this.auth.setupAuth(
        body,
        request.socket.remoteAddress ?? "unknown",
      ),
      response,
    );
  }
  @Post("login")
  @HttpCode(200)
  @ApiOperation({ operationId: "login" })
  @ApiBody({ type: D.LoginDto })
  @ApiOkResponse({ type: D.AuthSessionDto })
  async login(
    @Body(pipe(D.LoginDto)) body: D.LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this._session(
      await this.auth.login(body, request.socket.remoteAddress ?? "unknown"),
      response,
    );
  }
  @Post("logout")
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiOperation({ operationId: "logout" })
  @ApiOkResponse({ type: D.AuthSessionDto })
  async logout(@Res({ passthrough: true }) response: Response) {
    const state = await this.auth.logout();
    cookie(response, null);
    return state;
  }
  @Post("change-password")
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiOperation({ operationId: "changePassword" })
  @ApiBody({ type: D.ChangePasswordDto })
  @ApiOkResponse({ type: D.AuthSessionDto })
  async changePassword(
    @Body(pipe(D.ChangePasswordDto)) body: D.ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this._session(await this.auth.changePassword(body), response);
  }
  @Get("accounts")
  @ApiCookieAuth()
  @ApiOperation({ operationId: "getAuthAccounts" })
  @ApiOkResponse({ type: D.AuthAccountsDto })
  getAuthAccounts() {
    return this.auth.getAuthAccounts();
  }
  @Post("accounts")
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiOperation({ operationId: "createAuthAccount" })
  @ApiBody({ type: D.CreateAuthAccountDto })
  @ApiOkResponse({ type: D.AuthAccountsDto })
  createAuthAccount(
    @Body(pipe(D.CreateAuthAccountDto)) body: D.CreateAuthAccountDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this._accounts(this.auth.createAuthAccount(body), response);
  }
  @Post("accounts/:id")
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiOperation({ operationId: "updateAuthAccount" })
  @ApiParam({ name: "id", type: String })
  @ApiBody({ type: D.UpdateAuthAccountDto })
  @ApiOkResponse({ type: D.AuthAccountsDto })
  updateAuthAccount(
    @Param("id") id: string,
    @Body(pipe(D.UpdateAuthAccountDto)) body: D.UpdateAuthAccountDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this._accounts(this.auth.updateAuthAccount(id, body), response);
  }
  @Post("accounts/:id/password")
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiOperation({ operationId: "resetAuthPassword" })
  @ApiParam({ name: "id", type: String })
  @ApiBody({ type: D.ResetAuthPasswordDto })
  @ApiOkResponse({ type: D.AuthAccountsDto })
  resetAuthPassword(
    @Param("id") id: string,
    @Body(pipe(D.ResetAuthPasswordDto)) body: D.ResetAuthPasswordDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this._accounts(this.auth.resetAuthPassword(id, body), response);
  }
  @Post("accounts/:id/revoke-sessions")
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiOperation({ operationId: "revokeAuthSessions" })
  @ApiParam({ name: "id", type: String })
  @ApiOkResponse({ type: D.AuthAccountsDto })
  revokeAuthSessions(
    @Param("id") id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this._accounts(this.auth.revokeAuthSessions(id), response);
  }
}
