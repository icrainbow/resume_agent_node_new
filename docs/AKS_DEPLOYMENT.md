# AKS Deployment Guide

**Phase 5 PR1**
**Date:** 2025-12-25

This document describes how to deploy the Resume Agent application to Azure Kubernetes Service (AKS).

---

## Prerequisites

- Azure subscription
- AKS cluster created and configured
- `kubectl` configured to access your cluster
- Azure Database for PostgreSQL (or compatible PostgreSQL service)
- Azure Blob Storage account (for PR2/PR3)

---

## Secrets Management

### Phase 5: Kubernetes Secrets

Create a Kubernetes secret with database credentials:

```bash
kubectl create secret generic resume-agent-secrets \
  --from-literal=DATABASE_URL="postgresql://user:password@postgres-host:5432/resume_agent" \
  --from-literal=DEFAULT_OWNER_USER_ID="dev-user-1" \
  -n default
```

### Phase 6+: Azure Key Vault Integration

For production, use Azure Key Vault with Secrets Store CSI Driver:

1. Install CSI Driver:
   ```bash
   helm repo add csi-secrets-store-provider-azure https://azure.github.io/secrets-store-csi-driver-provider-azure/charts
   helm install csi csi-secrets-store-provider-azure/csi-secrets-store-provider-azure
   ```

2. Create SecretProviderClass:
   ```yaml
   apiVersion: secrets-store.csi.x-k8s.io/v1
   kind: SecretProviderClass
   metadata:
     name: resume-agent-secrets
   spec:
     provider: azure
     parameters:
       keyvaultName: "your-keyvault"
       tenantId: "your-tenant-id"
   ```

3. Mount secrets as volumes in deployment.

---

## Service Discovery

### Web → Worker Communication

The web service calls the worker service using Kubernetes DNS.

**Worker Service Definition:**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: worker-service
  namespace: default
spec:
  selector:
    app: worker
  ports:
  - protocol: TCP
    port: 8000
    targetPort: 8000
  type: ClusterIP
```

**Environment Variable in Web Deployment:**

```yaml
env:
- name: WORKER_BASE_URL
  value: "http://worker-service:8000"
```

**Important:** Never hardcode `localhost` in AKS deployments. Always use Kubernetes Service DNS names.

---

## Worker Deployment Configuration

### Phase 5 Requirement: Single Process Worker

The worker MUST run with `--workers 1` (single Uvicorn process) to ensure FastAPI BackgroundTasks execute reliably.

**Worker Deployment YAML:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker
  namespace: default
spec:
  replicas: 1  # Phase 5: single replica only
  selector:
    matchLabels:
      app: worker
  template:
    metadata:
      labels:
        app: worker
    spec:
      containers:
      - name: worker
        image: your-registry/resume-agent-worker:latest
        command:
          - "uvicorn"
          - "src.app:app"
          - "--host"
          - "0.0.0.0"
          - "--port"
          - "8000"
          - "--workers"
          - "1"  # CRITICAL: single process required for BackgroundTasks
        envFrom:
        - secretRef:
            name: resume-agent-secrets
        env:
        - name: POSTGRES_DSN
          valueFrom:
            secretKeyRef:
              name: resume-agent-secrets
              key: DATABASE_URL
        - name: AZURE_STORAGE_ACCOUNT_NAME
          value: "yourstorageaccount"
        - name: AZURE_STORAGE_CONTAINER_NAME
          value: "resume-agent"
        ports:
        - containerPort: 8000
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 8000
          initialDelaySeconds: 10
          periodSeconds: 5
```

**Why `--workers 1`?**

- FastAPI BackgroundTasks use in-process execution
- Multi-process workers distribute tasks unpredictably across processes
- Phase 5 does not have queue system for distributed task handling
- Phase 6 will replace BackgroundTasks with Azure Queue Storage, enabling multi-process scaling

---

## Web Deployment Configuration

**Web Deployment YAML:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: default
spec:
  replicas: 2  # Safe to scale web horizontally
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
      - name: web
        image: your-registry/resume-agent-web:latest
        envFrom:
        - secretRef:
            name: resume-agent-secrets
        env:
        - name: WORKER_BASE_URL
          value: "http://worker-service:8000"
        - name: AZURE_STORAGE_ACCOUNT_NAME
          value: "yourstorageaccount"
        - name: AZURE_STORAGE_CONTAINER_NAME
          value: "resume-agent"
        - name: NODE_ENV
          value: "production"
        ports:
        - containerPort: 3000
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /api/health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/ready
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
```

---

## Database Connection Pooling

### Prisma (Web)

Prisma uses connection pooling by default (10 connections per instance).

For AKS with multiple web pods:
- 2 replicas × 10 connections = 20 concurrent connections
- Monitor `pg_stat_activity` in PostgreSQL

**Adjust pool size if needed:**

```typescript
// web/lib/db/client.ts
export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  // Optional: custom connection pool
  // Note: Prisma doesn't expose direct pool config, use connection string params
});
```

**Connection string tuning:**

```
postgresql://user:pass@host:5432/db?schema=public&connection_limit=5&pool_timeout=20
```

### psycopg2 (Worker)

Worker uses psycopg2 connection pool (configured in PR2/PR3).

```python
pool = psycopg2.pool.SimpleConnectionPool(
    minconn=2,
    maxconn=10,
    dsn=os.getenv("POSTGRES_DSN")
)
```

**Total connection budget:**
- Web: 2 pods × 10 = 20
- Worker: 1 pod × 10 = 10
- Total: ~30 connections (safe for Standard PostgreSQL tier)

---

## Migration Strategy

See [MIGRATIONS.md](./MIGRATIONS.md) for detailed migration execution strategy.

**Summary:**
- Migrations run via Kubernetes Job (Helm pre-upgrade hook)
- Job uses web image (contains Prisma CLI)
- Runs `npx prisma migrate deploy`
- Blocks deployment until migrations succeed
- Idempotent (safe to rerun)

---

## Managed Identity (Production)

For production, use Azure Managed Identity instead of account keys.

### Enable Managed Identity

1. Assign identity to AKS node pool:
   ```bash
   az aks update \
     --resource-group myResourceGroup \
     --name myAKSCluster \
     --enable-managed-identity
   ```

2. Grant Storage Blob Data Contributor role:
   ```bash
   az role assignment create \
     --assignee <managed-identity-client-id> \
     --role "Storage Blob Data Contributor" \
     --scope /subscriptions/<sub-id>/resourceGroups/<rg>/providers/Microsoft.Storage/storageAccounts/<account>
   ```

3. Remove `AZURE_STORAGE_ACCOUNT_KEY` from secrets.

4. Code uses `DefaultAzureCredential` (no changes needed in PR2).

---

## Horizontal Scaling

### Web Pods (Safe to Scale)

Web is stateless and can scale horizontally:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: web-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: web
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

### Worker Pods (Phase 5: Single Replica Only)

**Do NOT scale worker in Phase 5:**
- `--workers 1` required for BackgroundTasks
- No queue system yet
- Scaling breaks in-process task execution

**Phase 6:** Replace BackgroundTasks with Azure Queue Storage, then scale:
```yaml
spec:
  replicas: 3  # Phase 6: safe to scale after queue integration
```

---

## Monitoring and Observability

### Health Checks

Implement health endpoints in both web and worker:

**Web:**
- `GET /api/health` → 200 OK (always)
- `GET /api/ready` → 200 OK if database reachable

**Worker:**
- `GET /health` → 200 OK (always)
- `GET /ready` → 200 OK if database reachable

### Logging

Logs are written to stdout (captured by Kubernetes).

**View logs:**
```bash
kubectl logs -f deployment/web -n default
kubectl logs -f deployment/worker -n default
```

**Phase 6:** Integrate with Azure Monitor / Application Insights.

---

## Rollback Procedure

If deployment fails:

```bash
# Rollback to previous deployment
kubectl rollout undo deployment/web -n default
kubectl rollout undo deployment/worker -n default

# Check rollout status
kubectl rollout status deployment/web -n default
```

**Note:** Database migrations are NOT auto-rolled back. See [MIGRATIONS.md](./MIGRATIONS.md) for schema rollback procedures.

---

## Troubleshooting

### Web cannot reach worker

**Symptom:** Errors like "Worker connection refused" or "ECONNREFUSED"

**Solution:**
1. Verify worker service exists: `kubectl get svc worker-service`
2. Verify worker pods running: `kubectl get pods -l app=worker`
3. Check WORKER_BASE_URL env var: `kubectl exec -it deployment/web -- env | grep WORKER`
4. Should be `http://worker-service:8000`, NOT `localhost`

### Database connection failures

**Symptom:** "Connection refused" or "authentication failed"

**Solution:**
1. Verify DATABASE_URL secret: `kubectl get secret resume-agent-secrets -o yaml`
2. Check PostgreSQL firewall allows AKS IP range
3. Test connection from pod:
   ```bash
   kubectl exec -it deployment/web -- bash
   apt-get update && apt-get install -y postgresql-client
   psql $DATABASE_URL
   ```

### Worker tasks timing out

**Symptom:** Tasks stuck in "running" status for >2 minutes

**Solution:**
1. Check worker logs: `kubectl logs -f deployment/worker`
2. Verify worker running with `--workers 1`: `kubectl exec -it deployment/worker -- ps aux | grep uvicorn`
3. Check pod resources (CPU/memory limits)
4. Check database connection pool not exhausted

---

## Security Checklist

- [ ] Secrets stored in Kubernetes Secrets (not committed to repo)
- [ ] DATABASE_URL does not contain plaintext password in logs
- [ ] WORKER_BASE_URL uses internal service DNS (not public IP)
- [ ] Network policies restrict pod-to-pod communication
- [ ] PostgreSQL firewall allows only AKS subnet
- [ ] Blob Storage uses Managed Identity (no account key in PR2+)
- [ ] TLS enabled for all external traffic (ingress)
- [ ] Resource limits set on all pods
- [ ] Non-root user in Docker images

---

## Next Steps

See [MIGRATIONS.md](./MIGRATIONS.md) for database migration execution strategy.
