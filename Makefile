frontend/index.html: frontend/*
	(cd frontend && npx -y jspm link -e production --integrity --preload --output index.html index.mjs) 

deploy: frontend/index.html
	terraform apply -auto-approve
