FROM debian:bookworm-slim
RUN apt-get update -y && apt-get install -y curl socat
# RUN curl -L -o /usr/local/bin/hasura
RUN curl -L https://github.com/hasura/graphql-engine/raw/stable/cli/get.sh | bash
RUN chmod +x /usr/local/bin/hasura
WORKDIR /app
COPY . .
RUN chmod +x ./start.sh
CMD ["./start.sh"]