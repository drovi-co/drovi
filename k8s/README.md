# Kubernetes Deployment

This directory contains Kubernetes manifests for deploying the SaaS Template application.

## Prerequisites

- Kubernetes cluster (1.25+)
- kubectl configured with cluster access
- NGINX Ingress Controller
- cert-manager (for TLS certificates)

## Quick Start

1. **Update configuration**

   Edit `configmap.yaml` and `secrets.yaml` with your values:

   ```bash
   # Update domains in configmap.yaml
   sed -i 's/memorystack.example.com/your-domain.com/g' configmap.yaml ingress.yaml

   # Update secrets (use base64 for actual deployment)
   kubectl create secret generic memorystack-secrets \
     --namespace=memorystack \
     --from-literal=DATABASE_URL='your-database-url' \
     --from-literal=BETTER_AUTH_SECRET='your-secret' \
     # ... other secrets
   ```

2. **Deploy using Kustomize**

   ```bash
   kubectl apply -k .
   ```

3. **Or deploy manifests individually**

   ```bash
   kubectl apply -f namespace.yaml
   kubectl apply -f configmap.yaml
   kubectl apply -f secrets.yaml
   kubectl apply -f server-deployment.yaml
   kubectl apply -f web-deployment.yaml
   kubectl apply -f ingress.yaml
   kubectl apply -f hpa.yaml
   kubectl apply -f pdb.yaml
   ```

## Components

| File | Description |
|------|-------------|
| `namespace.yaml` | Creates the memorystack namespace |
| `configmap.yaml` | Non-sensitive configuration |
| `secrets.yaml` | Sensitive configuration (passwords, API keys) |
| `server-deployment.yaml` | Backend API deployment and service |
| `web-deployment.yaml` | Frontend web deployment and service |
| `ingress.yaml` | Ingress rules for external access |
| `hpa.yaml` | Horizontal Pod Autoscalers |
| `pdb.yaml` | Pod Disruption Budgets for HA |
| `kustomization.yaml` | Kustomize configuration |

## Configuration

### Environment Variables

Update `configmap.yaml` for non-sensitive configuration:

- `NODE_ENV`: Environment (production)
- `BETTER_AUTH_URL`: API URL for authentication
- `CORS_ORIGIN`: Frontend URL
- `AI_PROVIDER`: AI provider to use

Update `secrets.yaml` for sensitive configuration:

- `DATABASE_URL`: PostgreSQL connection string
- `BETTER_AUTH_SECRET`: Auth secret (min 32 chars)
- `POLAR_ACCESS_TOKEN`: Polar.sh billing token
- OAuth credentials
- API keys

### Scaling

The HPA is configured to:
- **Server**: 2-10 replicas based on CPU (70%) and memory (80%)
- **Web**: 2-5 replicas based on CPU (70%)

Modify `hpa.yaml` to adjust scaling parameters.

### High Availability

- Pod anti-affinity ensures pods spread across nodes
- PodDisruptionBudgets ensure at least 1 pod during disruptions
- Liveness and readiness probes for health checking

## Production Checklist

- [ ] Update all domains in manifests
- [ ] Create secrets with actual values (not committed to git)
- [ ] Configure TLS certificates with cert-manager
- [ ] Set up external database (not in-cluster)
- [ ] Configure monitoring (Prometheus/Grafana)
- [ ] Set up log aggregation
- [ ] Configure backup strategy
- [ ] Review resource limits
- [ ] Enable network policies

## Monitoring

Deploy the application with Prometheus annotations:

```yaml
metadata:
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "3000"
    prometheus.io/path: "/metrics"
```

## Troubleshooting

```bash
# Check pod status
kubectl get pods -n memorystack

# View logs
kubectl logs -f deployment/memorystack-server -n memorystack

# Describe pod for events
kubectl describe pod <pod-name> -n memorystack

# Check ingress
kubectl get ingress -n memorystack

# Test connectivity
kubectl port-forward svc/memorystack-server 3000:80 -n memorystack
```
