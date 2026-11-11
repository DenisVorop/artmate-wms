"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { useSession } from "@/entities/session";
import { useWorkspace } from "@/entities/workspace";
import { providerName, useMarketplaces } from "@/entities/marketplaces";
import { Button, EmptyState, ErrorState, LoadingState } from "@/shared/ui";
import { useIntegrationActions } from "../model/use-integration-actions";
import { connectionPayload, mappingPayload } from "../lib/integration-form";
import { ConnectionCard } from "./connection-card";
import { ProductMapping } from "./product-mapping";
import { SkuCreate } from "./sku-create";
import { SkuBarcodes } from "./sku-barcodes";
import { SupplyDocuments } from "./supply-documents";
import styles from "./marketplace-integration.module.css";

export function MarketplaceIntegrationFeature() {
  const session = useSession(),
    query = useMarketplaces(session.isManager),
    workspace = useWorkspace();
  const actions = useIntegrationActions();
  const [notice, setNotice] = useState("");
  if (query.isPending) return <LoadingState label="Загружаем подключения…" />;
  if (!query.data) return <ErrorState onRetry={() => void query.refetch()} />;
  const data = query.data,
    skus = workspace.data?.skus ?? [];
  const unmapped = data.products.filter((product) => !product.skuId).length;
  return (
    <div className={styles.feature}>
      <header className={styles.header}>
        <div>
          <h1 className="page-heading">Маркетплейсы</h1>
          <p>Продажи, остатки и поставки обновляются каждые 30 минут.</p>
        </div>
        <Link className="button button--secondary" href="/planning">
          План сборки <ArrowUpRight size={16} />
        </Link>
      </header>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {query.isError && (
        <p className={styles.error} role="alert">
          Не удалось обновить подключения. На экране последние загруженные
          данные.
        </p>
      )}
      {actions.error && (
        <p className={styles.error} role="alert">
          Не удалось сохранить изменения. Проверьте данные и повторите попытку.
        </p>
      )}
      <div className={styles.cards}>
        {data.connections.map((connection) => (
          <ConnectionCard
            key={connection.provider}
            connection={connection}
            pending={actions.pending}
            onSave={async (values) => {
              const success = await actions.connect(
                connectionPayload(connection.provider, values),
              );
              if (success)
                setNotice(
                  `${providerName(connection.provider)}: подключение сохранено. Проверим его при ближайшем обновлении.`,
                );
              return success;
            }}
            onSync={async () => {
              setNotice("");
              return actions.sync(connection.provider);
            }}
            onToggle={async () => {
              const success = await actions.toggle(
                connection.provider,
                !connection.enabled,
              );
              if (success)
                setNotice(
                  `${providerName(connection.provider)}: подключение ${connection.enabled ? "отключено" : "включено"}.`,
                );
              return success;
            }}
          />
        ))}
      </div>
      <SupplyDocuments supplies={data.supplies} />
      {skus.length > 0 && <SkuBarcodes skus={skus} />}
      <details className={`glass-panel ${styles.catalog} ${styles.disclosure}`}>
        <summary>
          <span>Товары · {data.products.length}</span>
          {unmapped > 0 && (
            <span className={styles.warning}>
              Нужно связать с тематиками: {unmapped}
            </span>
          )}
        </summary>
        <div className={styles.sectionHeading}>
          <p>
            {!data.products.length
              ? "После загрузки свяжите товары с тематиками склада."
              : unmapped > 0
                ? "Выберите тематику для несвязанных товаров, чтобы они попали в план сборки."
                : "Все товары связаны с тематиками склада."}
          </p>
          <Button
            variant="ghost"
            size="sm"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw size={14} />
            Обновить список
          </Button>
        </div>
        <SkuCreate
          disabled={!workspace.data}
          onCreated={(name) =>
            setNotice(
              `Тематика «${name}» создана. Выберите её в карточках маркетплейсов.`,
            )
          }
        />
        {!data.products.length ? (
          <EmptyState
            title="Каталог ещё не загружен"
            description="Подключите маркетплейс — товары загрузятся автоматически."
          />
        ) : !workspace.data ? (
          <ErrorState
            message="Не удалось получить тематики склада. Соответствия недоступны до загрузки справочника."
            onRetry={() => void workspace.refetch()}
          />
        ) : (
          data.products.map((product) => (
            <ProductMapping
              key={`${product.provider}:${product.externalId}:${product.skuId}:${product.unitsPerItem}`}
              product={product}
              skus={skus}
              pending={actions.pending}
              onSave={async (values) => {
                const success = await actions.map(
                  mappingPayload(product, values),
                );
                if (success)
                  setNotice(`Соответствие для «${product.name}» сохранено.`);
                return success;
              }}
            />
          ))
        )}
      </details>
    </div>
  );
}
