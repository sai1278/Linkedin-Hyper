job "Acumen-Strapi" {
  datacenters = ["glynac-dc"]
  type        = "service"
  namespace   = "platform"

  update {
    max_parallel     = 1
    health_check     = "task_states"
    min_healthy_time = "30s"
  }

  # ===========================================
  # Strapi Application Group
  # ===========================================
  group "strapi-backend" {
    count = 1

    network {
      port "http" {
        static = 5603
        to     = 5603
      }
    }

    service {
      name = "acumen-strapi"
      tags = ["apps", "strapi"]
      port = "http"

      check {
        name     = "strapi-tcp"
        type     = "tcp"
        port     = "http"
        interval = "30s"
        timeout  = "5s"
      }
    }

    constraint {
      attribute = "${attr.unique.hostname}"
      value     = "Worker-08"
    }

    task "strapi" {
      driver = "docker"

      config {
        image       = "harbor-registry.service.consul:8085/acumen-blogs/strapi:IMAGE_TAG_PLACEHOLDER"
        ports       = ["http"]
        dns_servers = ["172.17.0.1", "172.18.0.1", "8.8.8.8", "8.8.4.4", "1.1.1.1"]
      }

      env {
        NODE_ENV = "production"
        HOST     = "0.0.0.0"
        PORT     = "5603"
      }

      vault {
        role = "acumen"
      }

      template {
        destination = "secrets/env"
        env         = true

        data = <<EOF
ADMIN_JWT_SECRET="{{ with secret "secrets/frontend/glynac-beta" }}{{ .Data.data.ADMIN_JWT_SECRET }}{{ end }}"
API_TOKEN_SALT="{{ with secret "secrets/frontend/glynac-beta" }}{{ .Data.data.API_TOKEN_SALT }}{{ end }}"
APP_KEYS="{{ with secret "secrets/frontend/glynac-beta" }}{{ .Data.data.APP_KEYS }}{{ end }}"
JWT_SECRET="{{ with secret "secrets/frontend/glynac-beta" }}{{ .Data.data.JWT_SECRET }}{{ end }}"
TRANSFER_TOKEN_SALT="{{ with secret "secrets/frontend/glynac-beta" }}{{ .Data.data.TRANSFER_TOKEN_SALT }}{{ end }}"

DATABASE_CLIENT="{{ with secret "secrets/frontend/glynac-beta" }}{{ .Data.data.DATABASE_CLIENT }}{{ end }}"
DATABASE_HOST="{{ with secret "secrets/frontend/glynac-beta" }}{{ .Data.data.DATABASE_HOST }}{{ end }}"
DATABASE_NAME="{{ with secret "secrets/frontend/glynac-beta" }}{{ .Data.data.DATABASE_NAME }}{{ end }}"
DATABASE_PASSWORD="{{ with secret "secrets/frontend/glynac-beta" }}{{ .Data.data.DATABASE_PASSWORD }}{{ end }}"
DATABASE_SSL="{{ with secret "secrets/frontend/glynac-beta" }}{{ .Data.data.DATABASE_SSL }}{{ end }}"
DATABASE_USERNAME="{{ with secret "secrets/frontend/glynac-beta" }}{{ .Data.data.DATABASE_USERNAME }}{{ end }}"
DATABASE_PORT="{{ with secret "secrets/frontend/glynac-beta" }}{{ .Data.data.DATABASE_PORT }}{{ end }}"
EOF
      }

      resources {
        cpu    = 200
        memory = 256
      }
    }
  }
}
