.PHONY: upgrade-arcana check-arcana

upgrade-arcana:
	ansible-playbook playbooks/upgrade-arcana.yml

check-arcana:
	ansible-playbook playbooks/upgrade-arcana.yml --check --diff
