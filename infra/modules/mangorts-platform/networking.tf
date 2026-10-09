data "aws_subnet" "public" {
  count = length(var.public_subnet_ids)

  id = var.public_subnet_ids[count.index]
}

resource "aws_subnet" "ecs_private" {
  count = local.managed_ecs_private_subnet_count

  vpc_id                  = var.vpc_id
  cidr_block              = var.ecs_private_subnet_cidrs[count.index]
  availability_zone       = data.aws_subnet.public[count.index % length(data.aws_subnet.public)].availability_zone
  map_public_ip_on_launch = false

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-ecs-private-${count.index + 1}"
    tier = "private"
  })
}

resource "aws_eip" "ecs_nat" {
  count = local.managed_nat_gateway_count

  domain = "vpc"

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-nat-${count.index + 1}"
  })
}

resource "aws_nat_gateway" "ecs" {
  count = local.managed_nat_gateway_count

  allocation_id = aws_eip.ecs_nat[count.index].id
  subnet_id     = var.public_subnet_ids[count.index % length(var.public_subnet_ids)]

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-nat-${count.index + 1}"
  })
}

resource "aws_route_table" "ecs_private" {
  count = local.managed_ecs_private_subnet_count

  vpc_id = var.vpc_id

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-ecs-private-${count.index + 1}"
  })
}

resource "aws_route" "ecs_private_nat" {
  count = var.ecs_nat_gateway_mode == "none" ? 0 : local.managed_ecs_private_subnet_count

  route_table_id         = aws_route_table.ecs_private[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.ecs[var.ecs_nat_gateway_mode == "per_az" ? count.index : 0].id
}

resource "aws_route_table_association" "ecs_private" {
  count = local.managed_ecs_private_subnet_count

  subnet_id      = aws_subnet.ecs_private[count.index].id
  route_table_id = aws_route_table.ecs_private[count.index].id
}
